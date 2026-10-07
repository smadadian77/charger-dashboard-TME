import json
import os
import unittest
from io import BytesIO
from unittest.mock import patch

import smart_investigations


def session_summary(identifier, status="Completed", **overrides):
    return {
        "id": identifier,
        "status": status,
        "connectorId": 1,
        "start": "2026-10-06T10:00:00Z",
        "end": "2026-10-06T10:20:00Z",
        "energyKwh": 4.2,
        "diagnosis": "normal/normal",
        "smartCharging": False,
        "stopReason": "Local",
        "authMode": "RFID",
        "durationSeconds": 1200,
        "startDiagnosis": "normal",
        "endDiagnosis": "normal",
        "verdict": "Normal session completion.",
        "eventCount": 2,
        "importantEventCount": 0,
        **overrides,
    }


def investigation_packet():
    return {
        "version": 1,
        "serialNumber": "TACW2244723S0930",
        "range": {"start": "2026-10-06T09:00:00Z", "end": "2026-10-06T11:00:00Z"},
        "status": {},
        "events": {"count": 2, "source": "loaded", "topNames": []},
        "sessions": {
            "count": 2,
            "source": "loaded",
            "statusCounts": {"Completed": 2},
            "selected": [session_summary("latest-session")],
            "focus": {
                "source": "selected",
                "session": session_summary("selected-session", "TimedOut", stopReason="Timeout", endDiagnosis="failed"),
                "previous": session_summary("previous-session"),
            },
        },
        "connectors": [],
        "incidents": [],
        "patterns": [],
        "diagnostics": [],
        "power": {},
        "quality": {},
        "evidence": [],
    }


class SmartInvestigationTests(unittest.TestCase):
    def setUp(self):
        with smart_investigations._rate_lock:
            smart_investigations._rate_windows.clear()

    def test_context_accepts_compact_focus_and_previous_session(self):
        packet = investigation_packet()

        self.assertIs(smart_investigations.validate_context(packet), packet)

    def test_context_rejects_unapproved_focus_fields_and_source(self):
        packet = investigation_packet()
        packet["sessions"]["focus"]["session"]["idTag"] = "must-not-pass"
        with self.assertRaisesRegex(ValueError, "unsupported fields"):
            smart_investigations.validate_context(packet)

        packet = investigation_packet()
        packet["sessions"]["focus"]["source"] = "guessed"
        with self.assertRaisesRegex(ValueError, "session focus"):
            smart_investigations.validate_context(packet)

    def test_context_accepts_an_explicit_but_unloaded_session_id(self):
        packet = investigation_packet()
        packet["sessions"]["focus"] = {
            "source": "requested",
            "requestedSessionId": "69",
            "session": None,
            "previous": None,
        }

        self.assertIs(smart_investigations.validate_context(packet), packet)

        packet["sessions"]["focus"]["requestedSessionId"] = "x" * 201
        with self.assertRaisesRegex(ValueError, "session focus"):
            smart_investigations.validate_context(packet)

    def test_secret_key_filter_rejects_credentials_but_allows_safe_auth_mode(self):
        packet = investigation_packet()
        smart_investigations._reject_secret_fields(packet)
        with self.assertRaisesRegex(ValueError, "prohibited field"):
            smart_investigations._reject_secret_fields({"apiKey": "not-a-real-key"})

    def test_findings_can_reference_focus_session_evidence(self):
        packet = investigation_packet()
        finding = {
            "title": "Session timed out",
            "summary": "The selected session ended with a timeout status.",
            "importance": "high",
            "confidence": "high",
            "evidence": [{"type": "session", "id": "selected-session"}],
        }

        result = smart_investigations.validate_findings([finding], packet)

        self.assertEqual(result[0]["evidence"][0]["id"], "selected-session")

    def test_generic_aggregate_diagnostic_finding_is_suppressed(self):
        packet = investigation_packet()
        packet["diagnostics"] = [
            {"id": "incidents", "status": "ATTENTION", "summary": "Incident evidence requires review."},
            {"id": "events", "status": "ATTENTION", "summary": "Event sequences require review."},
            {"id": "patterns", "status": "ATTENTION", "summary": "Recurring patterns require review."},
        ]
        generic_finding = {
            "title": "Diagnostic Attention Status",
            "summary": "Diagnostics report an ATTENTION status for incidents, event sequences, and recurring patterns, suggesting the system has flagged abnormal behavior.",
            "importance": "medium",
            "confidence": "medium",
            "evidence": [{"type": "diagnostic", "id": item["id"]} for item in packet["diagnostics"]],
        }

        self.assertEqual(smart_investigations.validate_findings([generic_finding], packet), [])

    def test_specific_diagnostic_finding_is_retained(self):
        packet = investigation_packet()
        packet["diagnostics"] = [
            {"id": "connector-state", "status": "FAIL", "summary": "Connector 1 was Faulted for 12 minutes."}
        ]
        specific_finding = {
            "title": "Connector 1 was Faulted",
            "summary": "The connector-state diagnostic recorded a Faulted status for 12 minutes.",
            "importance": "high",
            "confidence": "high",
            "evidence": [{"type": "diagnostic", "id": "connector-state"}],
        }

        result = smart_investigations.validate_findings([specific_finding], packet)

        self.assertEqual(result[0]["evidence"][0]["id"], "connector-state")

    def test_specific_boot_finding_survives_alongside_generic_diagnostic_summary(self):
        packet = investigation_packet()
        packet["diagnostics"] = [
            {"id": "incidents", "status": "ATTENTION", "summary": "Incident evidence requires review."},
            {"id": "events", "status": "ATTENTION", "summary": "Event sequences require review."},
            {"id": "patterns", "status": "ATTENTION", "summary": "Recurring patterns require review."},
        ]
        packet["evidence"] = [{
            "type": "event", "id": "boot-1", "timestamp": "2026-10-06T10:00:00Z",
            "summary": "BootNotification · connector 1",
        }]
        generic_finding = {
            "title": "Diagnostic Attention Status",
            "summary": "Diagnostics report an ATTENTION status for incidents, event sequences, and recurring patterns, suggesting abnormal behavior.",
            "importance": "medium", "confidence": "medium",
            "evidence": [{"type": "diagnostic", "id": item["id"]} for item in packet["diagnostics"]],
        }
        specific_finding = {
            "title": "Frequent Boot Events",
            "summary": "Four boot events occurred in the selected window.",
            "importance": "high", "confidence": "high",
            "evidence": [{"type": "event", "id": "boot-1"}],
        }

        result = smart_investigations.validate_findings([generic_finding, specific_finding], packet)

        self.assertEqual([finding["title"] for finding in result], ["Frequent Boot Events"])

    def test_chat_prompt_includes_focus_and_previous_session_without_history(self):
        packet = investigation_packet()
        with patch("smart_investigations._generate", return_value="The selected session timed out.") as generate:
            result = smart_investigations.answer_question(packet, [], "Why did this session fail?", "chat-focus-test")

        self.assertEqual(result["answer"], "The selected session timed out.")
        prompt = generate.call_args.args[0]
        self.assertEqual(prompt["packet"]["sessions"]["focus"]["source"], "selected")
        self.assertEqual(prompt["packet"]["sessions"]["focus"]["session"]["stopReason"], "Timeout")
        self.assertEqual(prompt["packet"]["sessions"]["focus"]["previous"]["id"], "previous-session")

    def test_chat_prompt_keeps_an_unloaded_requested_session_explicit(self):
        packet = investigation_packet()
        packet["sessions"]["focus"] = {
            "source": "requested",
            "requestedSessionId": "69",
            "session": None,
            "previous": None,
        }
        with patch("smart_investigations._generate", return_value="Session 69 is not in the loaded data.") as generate:
            result = smart_investigations.answer_question(packet, [], "What happened in session 69?", "missing-session-test")

        self.assertIn("session 69 is not in the loaded data", result["answer"].lower())
        self.assertEqual(generate.call_args.args[0]["packet"]["sessions"]["focus"]["requestedSessionId"], "69")
        self.assertIn("Never substitute the latest session", generate.call_args.args[1])

    def test_findings_retries_once_when_model_returns_malformed_json(self):
        with patch("smart_investigations._generate", side_effect=["not json", '{"findings": []}']) as generate:
            result = smart_investigations.generate_findings(investigation_packet(), "malformed-json-test")

        self.assertEqual(result["findings"], [])
        self.assertEqual(generate.call_count, 2)

    def test_provider_request_uses_dashboard_user_agent(self):
        response_body = b'{"choices":[{"message":{"content":"OK"}}]}'
        with patch.dict(os.environ, {"GROQ_API_KEY": "synthetic-groq-key", "GROQ_MODEL": "example/model"}), \
                patch("smart_investigations.urlopen", return_value=BytesIO(response_body)) as urlopen_mock:
            result = smart_investigations._generate({"probe": "test"}, "Reply OK.")

        request = urlopen_mock.call_args.args[0]
        self.assertEqual(result, "OK")
        self.assertEqual(request.get_header("User-agent"), "ChargerDashboard/1.0")

    def test_findings_do_not_retry_malformed_json_more_than_once(self):
        with patch("smart_investigations._generate", return_value="not json") as generate:
            with self.assertRaises(smart_investigations.SmartInvestigationError) as raised:
                smart_investigations.generate_findings(investigation_packet(), "malformed-json-failure-test")

        self.assertEqual(raised.exception.code, "invalid_response")
        self.assertEqual(generate.call_count, 2)

    def test_local_rate_limit_is_shared_by_insights_and_chat(self):
        with patch.object(smart_investigations, "RATE_LIMIT_REQUESTS", 1), \
                patch("smart_investigations._generate", return_value="Grounded answer."):
            smart_investigations.answer_question(investigation_packet(), [], "What happened?", "shared-limit-test")
            with self.assertRaises(smart_investigations.SmartInvestigationError) as raised:
                smart_investigations.generate_findings(investigation_packet(), "shared-limit-test")

        self.assertEqual(raised.exception.code, "local_rate_limited")


if __name__ == "__main__":
    unittest.main()