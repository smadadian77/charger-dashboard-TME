import json
import unittest

from backend.services.support_ops_service import (
    _build_support_operation_request,
    _classify_support_response,
    _get_support_operation_context,
    _sanitize_support_response,
)


class SupportOperationServiceTests(unittest.TestCase):
    def test_align_pin_builds_expected_request_without_sending_it(self):
        request = _build_support_operation_request(
            "alignPin",
            "TACW2244723S0930",
            "synthetic-test-token",
            {"ownerPin": "12345"},
            "prod",
        )

        self.assertEqual(request.get_method(), "PATCH")
        self.assertEqual(
            request.full_url,
            "https://tme-ev-chargingplatform.toyota-europe.com/v2/wallbox-management/wallboxes/TACW2244723S0930/pin",
        )
        self.assertEqual(json.loads(request.data), {"ownerPin": "12345"})

    def test_operation_context_rejects_invalid_serial(self):
        with self.assertRaisesRegex(ValueError, "valid selected charger serial"):
            _get_support_operation_context(
                "alignPin",
                "invalid-serial",
                "synthetic-test-token",
                {"ownerPin": "12345"},
                "prod",
            )

    def test_firmware_location_must_use_https(self):
        with self.assertRaisesRegex(ValueError, "HTTPS URL"):
            _get_support_operation_context(
                "pushFirmware",
                "TACW2244723S0930",
                "synthetic-test-token",
                {"location": "http://firmware.example/update.bin", "retrieveDate": "2026-10-02T12:00:00Z"},
                "prod",
            )

    def test_missing_pending_operation_is_not_reported_as_failure(self):
        status = _classify_support_response(
            "removePendingRemoteOperation",
            404,
            "No pending operation found",
        )

        self.assertEqual(status, "NO_ACTION_REQUIRED")

    def test_response_redacts_secret_fields_and_values(self):
        sanitized = _sanitize_support_response(
            {
                "token": "synthetic-test-token",
                "nested": {
                    "ownerPin": "12345",
                    "message": "synthetic-test-token",
                    "status": "ACCEPTED",
                },
            },
            ["synthetic-test-token", "12345"],
        )

        self.assertEqual(
            sanitized,
            {
                "token": "[REDACTED]",
                "nested": {
                    "ownerPin": "[REDACTED]",
                    "message": "[REDACTED]",
                    "status": "ACCEPTED",
                },
            },
        )


if __name__ == "__main__":
    unittest.main()