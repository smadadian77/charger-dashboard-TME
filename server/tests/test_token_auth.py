import base64
import json
import os
import tempfile
import time
import unittest
from unittest.mock import MagicMock, patch

from backend.auth import (
    ENV_CLIENT_IDS,
    capture_token_from_browser,
    get_token_status,
    is_token_expired,
    is_tme_token,
    is_token_capture_running,
    read_saved_token,
    start_token_capture,
    store_captured_token,
    write_saved_token,
)


def make_token(payload):
    def encode(value):
        return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip("=")

    return f"{encode({'alg': 'none', 'typ': 'JWT'})}.{encode(payload)}.synthetic"


class TokenAuthTests(unittest.TestCase):
    def test_token_audience_is_bound_to_selected_environment(self):
        exp = int(time.time()) + 3600
        prod_token = make_token({"aud": next(iter(ENV_CLIENT_IDS["prod"])), "exp": exp})
        acc_token = make_token({"aud": next(iter(ENV_CLIENT_IDS["acc"])), "exp": exp})
        graph_token = make_token({"aud": "https://graph.microsoft.com", "exp": exp})
        malformed_audience = make_token({"aud": [["nested"]], "exp": exp})

        self.assertTrue(is_tme_token(prod_token, "prod"))
        self.assertFalse(is_tme_token(prod_token, "acc"))
        self.assertTrue(is_tme_token(acc_token, "acc"))
        self.assertFalse(is_tme_token(graph_token, "prod"))
        self.assertFalse(is_tme_token(malformed_audience, "prod"))

    def test_token_expiry_requires_a_finite_future_expiration(self):
        self.assertFalse(is_token_expired(make_token({"aud": next(iter(ENV_CLIENT_IDS["prod"])), "exp": int(time.time()) + 3600})))
        self.assertTrue(is_token_expired(make_token({"aud": next(iter(ENV_CLIENT_IDS["prod"])), "exp": int(time.time()) - 60})))
        self.assertTrue(is_token_expired(make_token({"aud": next(iter(ENV_CLIENT_IDS["prod"])), "exp": "later"})))
        self.assertTrue(is_token_expired(make_token({"aud": next(iter(ENV_CLIENT_IDS["prod"])), "exp": float("nan")})))
        self.assertTrue(is_token_expired(make_token({"aud": next(iter(ENV_CLIENT_IDS["prod"])), "exp": 10 ** 1000})))

    def test_token_status_classifies_saved_tokens_without_returning_them(self):
        prod_audience = next(iter(ENV_CLIENT_IDS["prod"]))
        with tempfile.TemporaryDirectory() as directory:
            token_path = os.path.join(directory, "token.json")
            with patch("backend.auth.get_token_file", return_value=token_path), \
                    patch("backend.auth.is_token_capture_running", return_value=False):
                write_saved_token(make_token({"aud": prod_audience, "exp": int(time.time()) + 3600}), "prod")
                valid = get_token_status("prod")
                self.assertEqual(valid["status"], "valid")
                self.assertNotIn("token", valid)

                write_saved_token(make_token({"aud": prod_audience, "exp": int(time.time()) - 60}), "prod")
                expired = get_token_status("prod")
                self.assertEqual(expired["status"], "expired")
                self.assertTrue(expired["expired"])
                self.assertNotIn("token", expired)

                write_saved_token(make_token({"aud": "other-client", "exp": int(time.time()) + 3600}), "prod")
                invalid = get_token_status("prod")
                self.assertEqual(invalid["status"], "invalid")
                self.assertNotIn("token", invalid)

                write_saved_token("not-a-jwt", "prod")
                malformed = get_token_status("prod")
                self.assertEqual(malformed["status"], "invalid")
                self.assertFalse(malformed["expired"])

    def test_rejected_capture_does_not_delete_a_valid_saved_token(self):
        prod_audience = next(iter(ENV_CLIENT_IDS["prod"]))
        valid_token = make_token({"aud": prod_audience, "exp": int(time.time()) + 3600})
        wrong_environment_token = make_token({"aud": next(iter(ENV_CLIENT_IDS["acc"])), "exp": int(time.time()) + 3600})

        with tempfile.TemporaryDirectory() as directory:
            token_path = os.path.join(directory, "token.json")
            with patch("backend.auth.get_token_file", return_value=token_path):
                write_saved_token(valid_token, "prod")
                self.assertFalse(store_captured_token(wrong_environment_token, "prod"))
                self.assertEqual(read_saved_token("prod", allow_browser_scan=False), valid_token)

    def test_charger_and_fota_tokens_are_stored_and_deleted_independently(self):
        audience = next(iter(ENV_CLIENT_IDS["prod"]))
        charger_token = make_token({"aud": audience, "exp": int(time.time()) + 3600, "iat": 100})
        fota_token = make_token({"aud": audience, "exp": int(time.time()) + 3600, "iat": 200})

        with tempfile.TemporaryDirectory() as directory:
            def token_path(env, app="charger"):
                return os.path.join(directory, f"{app}-{env}.json")

            with patch("backend.auth.get_token_file", side_effect=token_path):
                write_saved_token(charger_token, "prod")
                write_saved_token(fota_token, "prod", app="fota")

                self.assertEqual(read_saved_token("prod", app="charger"), charger_token)
                self.assertEqual(read_saved_token("prod", app="fota"), fota_token)

                from backend.auth import delete_saved_token
                delete_saved_token("prod", "charger")
                self.assertEqual(read_saved_token("prod", app="charger"), "")
                self.assertEqual(read_saved_token("prod", app="fota"), fota_token)

    def test_callback_rejects_token_older_than_latest_force_refresh(self):
        audience = next(iter(ENV_CLIENT_IDS["prod"]))
        old_token = make_token({"aud": audience, "exp": int(time.time()) + 3600, "iat": 100})
        fresh_token = make_token({"aud": audience, "exp": int(time.time()) + 3600, "iat": 200})
        with tempfile.TemporaryDirectory() as directory:
            token_path = os.path.join(directory, "prod.json")
            with patch("backend.auth.get_token_file", return_value=token_path):
                self.assertFalse(store_captured_token(old_token, "prod", min_issued_at=150))
                self.assertTrue(store_captured_token(fresh_token, "prod", min_issued_at=150))
                self.assertEqual(read_saved_token("prod", allow_browser_scan=False), fresh_token)

    def test_non_object_token_file_is_treated_as_missing(self):
        with tempfile.TemporaryDirectory() as directory:
            token_path = os.path.join(directory, "token.json")
            with open(token_path, "w", encoding="utf-8") as handle:
                handle.write("[]")
            with patch("backend.auth.get_token_file", return_value=token_path), \
                    patch("backend.auth.is_token_capture_running", return_value=False):
                status = get_token_status("prod")
        self.assertEqual(status["status"], "missing")

    def test_token_file_write_replaces_atomically_and_cleans_temporary_file(self):
        audience = next(iter(ENV_CLIENT_IDS["prod"]))
        token = make_token({"aud": audience, "exp": int(time.time()) + 3600})
        with tempfile.TemporaryDirectory() as directory:
            token_path = os.path.join(directory, "tokens", "prod.json")
            with patch("backend.auth.get_token_file", return_value=token_path):
                write_saved_token(token, "prod")
                with open(token_path, "r", encoding="utf-8") as handle:
                    self.assertEqual(json.load(handle)["token"], token)
            self.assertEqual(os.listdir(os.path.dirname(token_path)), ["prod.json"])

    def test_saved_token_reads_do_not_scan_browser_storage_implicitly(self):
        with tempfile.TemporaryDirectory() as directory:
            token_path = os.path.join(directory, "missing-token.json")
            with patch("backend.auth.get_token_file", return_value=token_path), \
                    patch("backend.auth.capture_token_from_browser") as scan_browser:
                self.assertEqual(read_saved_token("prod"), "")
        scan_browser.assert_not_called()

    def test_browser_scan_extracts_synthetic_utf16_storage_token_for_environment(self):
        audience = next(iter(ENV_CLIENT_IDS["prod"]))
        token = make_token({"aud": audience, "exp": int(time.time()) + 3600})
        storage_bytes = ("{" + token + "}").encode("utf-16le")

        with tempfile.TemporaryDirectory() as directory:
            with open(os.path.join(directory, "000001.ldb"), "wb") as handle:
                handle.write(b"synthetic")
            with patch("tme_token_bridge.storage_dirs", return_value=[directory]), \
                    patch("tme_token_bridge.read_shared", return_value=storage_bytes):
                captured = capture_token_from_browser("prod")

        self.assertEqual(captured, token)

    def test_forced_capture_passes_freshness_threshold_without_deleting_saved_token(self):
        process_registry = {}
        with patch("backend.auth.TOKEN_CAPTURE_PROCESSES", process_registry), \
                patch("backend.auth.subprocess.Popen") as popen, \
                patch("builtins.open", return_value=MagicMock()), \
                patch("backend.auth.delete_saved_token") as delete_token:
            start_token_capture("acc", force=True, no_browser=True, min_issued_at=1234567890)

        command = popen.call_args.args[0]
        self.assertIn("--no-browser", command)
        self.assertEqual(command[command.index("--min-issued-at") + 1], "1234567890")
        delete_token.assert_not_called()

    def test_non_forced_capture_joins_existing_process(self):
        running_process = MagicMock()
        running_process.poll.return_value = None
        process_registry = {"acc": running_process}
        with patch("backend.auth.TOKEN_CAPTURE_PROCESSES", process_registry), \
                patch("backend.auth.subprocess.Popen") as popen:
            self.assertTrue(start_token_capture("acc", force=False))

        popen.assert_not_called()
        self.assertIs(process_registry["acc"], running_process)

    def test_forced_capture_terminates_existing_process_once(self):
        running_process = MagicMock()
        running_process.poll.return_value = None
        replacement_process = MagicMock()
        process_registry = {"acc": running_process}
        log_context = MagicMock()
        log_context.__enter__.return_value = MagicMock()

        with patch("backend.auth.TOKEN_CAPTURE_PROCESSES", process_registry), \
                patch("backend.auth.subprocess.Popen", return_value=replacement_process) as popen, \
                patch("builtins.open", return_value=log_context):
            self.assertTrue(start_token_capture("acc", force=True, no_browser=True, min_issued_at=1234567890))

        running_process.terminate.assert_called_once()
        running_process.wait.assert_called_once_with(timeout=5)
        self.assertIs(process_registry["acc"], replacement_process)
        self.assertIn("--no-browser", popen.call_args.args[0])
        self.assertIn("--min-issued-at", popen.call_args.args[0])

    def test_stale_bridge_process_is_removed_from_registry(self):
        stale_process = MagicMock()
        stale_process.poll.return_value = 1
        process_registry = {"prev": stale_process}

        with patch("backend.auth.TOKEN_CAPTURE_PROCESSES", process_registry):
            self.assertFalse(is_token_capture_running("prev"))

        self.assertNotIn("prev", process_registry)

    def test_force_refresh_does_not_spawn_duplicate_if_old_process_cannot_stop(self):
        running_process = MagicMock()
        running_process.poll.return_value = None
        running_process.terminate.side_effect = OSError("synthetic stop failure")
        process_registry = {"acc": running_process}

        with patch("backend.auth.TOKEN_CAPTURE_PROCESSES", process_registry), \
                patch("backend.auth.subprocess.Popen") as popen:
            self.assertTrue(start_token_capture("acc", force=True, no_browser=True))

        popen.assert_not_called()
        self.assertIs(process_registry["acc"], running_process)


if __name__ == "__main__":
    unittest.main()