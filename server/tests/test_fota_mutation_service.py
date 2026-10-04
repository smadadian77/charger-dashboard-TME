import json
import os
import unittest
from unittest.mock import MagicMock, patch
from urllib.parse import urlparse

from backend.services.fota_mutation_service import (
    FotaMutationError,
    execute_local_mutation,
    is_loopback_local_request,
    mutation_capabilities,
)


class FotaMutationSafetyTests(unittest.TestCase):
    def test_mutation_request_requires_loopback_peer_and_origin(self):
        self.assertTrue(is_loopback_local_request("127.0.0.1", "http://localhost:4200"))
        self.assertTrue(is_loopback_local_request("::1", None))
        self.assertFalse(is_loopback_local_request("192.168.1.20", "http://localhost:4200"))
        self.assertFalse(is_loopback_local_request("127.0.0.1", "https://remote.example"))
        self.assertFalse(is_loopback_local_request("127.0.0.1", "null"))
        self.assertFalse(is_loopback_local_request("127.0.0.1", "http://localhost:9999"))

    def test_local_ui_origin_can_be_configured_for_an_alternate_port(self):
        with patch.dict(os.environ, {"LOCAL_APP_ORIGINS": "http://localhost:4300"}, clear=True):
            self.assertTrue(is_loopback_local_request("127.0.0.1", "http://localhost:4300"))
            self.assertFalse(is_loopback_local_request("127.0.0.1", "http://localhost:4200"))

    def test_mutations_are_disabled_without_explicit_configuration(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertFalse(mutation_capabilities()["enabled"])
            with self.assertRaisesRegex(FotaMutationError, "require FOTA_MUTATIONS_ENABLED"):
                execute_local_mutation("beta-wallbox-add", {"serialNumber": "TACW2243722S1650"})

    @patch("backend.services.fota_mutation_service.urlopen")
    def test_toyota_mutation_target_is_blocked(self, urlopen):
        with patch.dict(os.environ, {
            "FOTA_MUTATIONS_ENABLED": "true",
            "FOTA_MUTATION_BASE_URL": "https://tme-ev-chargingplatform-acc.toyota-europe.com",
        }, clear=True):
            with self.assertRaisesRegex(FotaMutationError, "loopback FOTA_MUTATION_BASE_URL"):
                execute_local_mutation("beta-wallbox-add", {"serialNumber": "TACW2243722S1650"})
        urlopen.assert_not_called()

    @patch("backend.services.fota_mutation_service.urlopen")
    def test_beta_wallbox_add_builds_patch_for_loopback_mock_only(self, urlopen):
        response = MagicMock()
        response.status = 200
        response.read.return_value = b'{"ok":true}'
        manager = MagicMock()
        manager.__enter__.return_value = response
        urlopen.return_value = manager

        with patch.dict(os.environ, {
            "FOTA_MUTATIONS_ENABLED": "true",
            "FOTA_MUTATION_BASE_URL": "http://127.0.0.1:9011/mock-fota",
        }, clear=True):
            result = execute_local_mutation("beta-wallbox-add", {"serialNumber": "TACW2243722S1650"})

        request = urlopen.call_args.args[0]
        self.assertEqual(request.get_method(), "PATCH")
        self.assertEqual(
            request.full_url,
            "http://127.0.0.1:9011/mock-fota/v2/fota-management/wallboxes/TACW2243722S1650/add-beta-wallbox",
        )
        self.assertEqual(request.data, b"")
        self.assertIsNone(request.get_header("Authorization"))
        self.assertEqual(result, {"status": 200, "response": {"ok": True}})

    @patch("backend.services.fota_mutation_service.urlopen")
    def test_firmware_readiness_uses_version_model_beta_route(self, urlopen):
        response = MagicMock()
        response.status = 200
        response.read.return_value = b"{}"
        manager = MagicMock()
        manager.__enter__.return_value = response
        urlopen.return_value = manager

        with patch.dict(os.environ, {
            "FOTA_MUTATIONS_ENABLED": "true",
            "FOTA_MUTATION_BASE_URL": "http://localhost:9011/mock-fota",
        }, clear=True):
            execute_local_mutation("firmware-readiness", {
                "version": "3.3.3",
                "model": "Terra AC",
                "beta": False,
                "enabled": True,
            })

        request = urlopen.call_args.args[0]
        self.assertEqual(request.get_method(), "POST")
        self.assertEqual(
            request.full_url,
            "http://localhost:9011/mock-fota/v1/wallboxes/firmware/3.3.3/Terra%20AC/false/enable",
        )
        self.assertEqual(request.get_header("Clientid"), "ctp")

    @patch("backend.services.fota_mutation_service.urlopen")
    def test_beta_approval_includes_required_client_id(self, urlopen):
        response = MagicMock()
        response.status = 200
        response.read.return_value = b"{}"
        manager = MagicMock()
        manager.__enter__.return_value = response
        urlopen.return_value = manager

        with patch.dict(os.environ, {
            "FOTA_MUTATIONS_ENABLED": "true",
            "FOTA_MUTATION_BASE_URL": "http://localhost:9011/mock-fota",
        }, clear=True):
            execute_local_mutation("approve-beta-firmware", {
                "version": "3.3.3",
                "model": "Terra AC",
                "beta": True,
                "testReportUri": "https://example.test/report.pdf",
            })

        request = urlopen.call_args.args[0]
        self.assertEqual(request.get_method(), "PATCH")
        self.assertTrue(request.full_url.endswith(
            "/v2/fota-management/firmware/3.3.3/Terra%20AC/true/approval-status-update"
        ))
        self.assertEqual(request.get_header("Clientid"), "ctp")

    @patch("backend.services.fota_mutation_service.urlopen")
    def test_campaign_create_uses_observed_payload_and_post_method(self, urlopen):
        response = MagicMock()
        response.status = 202
        response.read.return_value = b"{}"
        manager = MagicMock()
        manager.__enter__.return_value = response
        urlopen.return_value = manager
        campaign = {"model": "TAC-W22-S-RD-MC-0", "countryId": "BE", "childrenVersions": ["1.6.6"]}

        with patch.dict(os.environ, {
            "FOTA_MUTATIONS_ENABLED": "true",
            "FOTA_MUTATION_BASE_URL": "http://localhost:9011/mock-fota",
        }, clear=True):
            execute_local_mutation("create-campaign", {"firmwareVersion": "1.6.9", "campaign": campaign})

        request = urlopen.call_args.args[0]
        self.assertEqual(request.get_method(), "POST")
        self.assertTrue(request.full_url.endswith("/v1/firmware/1.6.9/campaign"))
        self.assertEqual(json.loads(request.data), campaign)
        self.assertIsNone(request.get_header("Authorization"))

    @patch("backend.services.fota_mutation_service.urlopen")
    def test_compleo_campaign_uses_vendor_v2_route(self, urlopen):
        response = MagicMock()
        response.status = 201
        response.read.return_value = b"{}"
        manager = MagicMock()
        manager.__enter__.return_value = response
        urlopen.return_value = manager
        campaign = {"model": None, "vendor": "COMPLEO", "countryId": "BE"}

        with patch.dict(os.environ, {
            "FOTA_MUTATIONS_ENABLED": "true",
            "FOTA_MUTATION_BASE_URL": "http://localhost:9011/mock-fota",
        }, clear=True):
            execute_local_mutation("create-campaign", {"firmwareVersion": "1.6.9", "campaign": campaign})

        request = urlopen.call_args.args[0]
        self.assertEqual(request.get_method(), "POST")
        self.assertTrue(request.full_url.endswith("/v2/fota-management/firmware/1.6.9/campaign"))
        self.assertEqual(json.loads(request.data), campaign)
        self.assertEqual(request.get_header("Clientid"), "ctp")


if __name__ == "__main__":
    unittest.main()