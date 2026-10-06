import json
import unittest
from unittest.mock import MagicMock, patch
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlparse

from backend.services.fota_service import (
    FotaReadError,
    get_package,
    get_filter_metadata,
    get_model_matrix,
    list_campaigns,
    list_launched_campaigns_by_vendor,
    list_packages,
    list_wallboxes,
)


def mock_response(payload, status=200):
    response = MagicMock()
    response.status = status
    response.read.return_value = json.dumps(payload).encode("utf-8")
    manager = MagicMock()
    manager.__enter__.return_value = response
    return manager


class FotaReadServiceTests(unittest.TestCase):
    @patch("backend.services.fota_service.urlopen")
    def test_forbidden_is_reported_as_fota_role_denial_not_expired_session(self, urlopen):
        urlopen.side_effect = HTTPError("https://example.invalid", 403, "Forbidden", None, None)

        with self.assertRaises(FotaReadError) as error:
            list_packages("acc", "synthetic-token")

        self.assertEqual(error.exception.status_code, 403)
        self.assertIn("access role", str(error.exception))
        self.assertNotIn("expired", str(error.exception))

    @patch("backend.services.fota_service.urlopen")
    def test_package_list_is_get_with_observed_filters(self, urlopen):
        urlopen.return_value = mock_response({"data": {"content": [], "totalElements": 0}})

        list_packages(
            "acc",
            "synthetic-test-token",
            page=2,
            size=10,
            beta=False,
            filters={
                "vendor": "ChargeDot",
                "isPushable": False,
                "approvalStatus": "TESTED",
                "unassignedCampaign": True,
            },
        )

        request = urlopen.call_args.args[0]
        self.assertEqual(request.get_method(), "GET")
        self.assertEqual(urlparse(request.full_url).path, "/v1/firmware")
        self.assertEqual(request.get_header("Clientid"), "ctp")
        self.assertEqual(
            parse_qs(urlparse(request.full_url).query),
            {
                "page": ["2"], "size": ["10"], "beta": ["false"], "vendor": ["ChargeDot"],
                "isPushable": ["false"], "approvalStatus": ["TESTED"], "unassignedCampaign": ["true"],
            },
        )

    @patch("backend.services.fota_service.urlopen")
    def test_campaign_list_is_read_only_and_uses_paging(self, urlopen):
        urlopen.return_value = mock_response({"data": {"content": [], "totalElements": 0}})

        list_campaigns("acc", "synthetic-test-token", page=0, size=5, beta=False)

        request = urlopen.call_args.args[0]
        self.assertEqual(request.get_method(), "GET")
        self.assertEqual(urlparse(request.full_url).path, "/v1/campaign")
        self.assertEqual(parse_qs(urlparse(request.full_url).query), {"page": ["0"], "size": ["5"], "beta": ["false"]})
        self.assertEqual(request.get_header("Clientid"), "ctp")

    @patch("backend.services.fota_service.urlopen")
    def test_compleo_launched_campaigns_use_vendor_query(self, urlopen):
        urlopen.return_value = mock_response({"data": {"launchedCampaignsList": []}})

        list_launched_campaigns_by_vendor("acc", "synthetic-test-token", "BE", "COMPLEO")

        request = urlopen.call_args.args[0]
        self.assertEqual(request.get_method(), "GET")
        self.assertEqual(urlparse(request.full_url).path, "/v2/fota-management/campaign/launched/BE")
        self.assertEqual(parse_qs(urlparse(request.full_url).query), {"vendor": ["COMPLEO"]})

    @patch("backend.services.fota_service.urlopen")
    def test_wallbox_list_repeats_country_ids_and_sets_beta(self, urlopen):
        urlopen.return_value = mock_response({"data": {"content": [], "totalElements": 0}})

        list_wallboxes(
            "acc",
            "synthetic-test-token",
            beta=True,
            filters={"serialNumber": "TACW2244723S0930", "countryIds": ["BE", "DE"]},
        )

        request = urlopen.call_args.args[0]
        self.assertEqual(request.get_method(), "GET")
        self.assertEqual(
            parse_qs(urlparse(request.full_url).query),
            {"page": ["0"], "size": ["5"], "beta": ["true"], "serialNumber": ["TACW2244723S0930"], "countryIds": ["BE", "DE"]},
        )

    @patch("backend.services.fota_service.urlopen")
    def test_package_detail_encodes_firmware_id_and_uses_ctp_header(self, urlopen):
        urlopen.return_value = mock_response({"data": {"version": "3.3.3", "model": "Terra AC"}})

        get_package("acc", "synthetic-test-token", "3.3.3", "Terra AC", False)

        request = urlopen.call_args.args[0]
        self.assertEqual(request.get_method(), "GET")
        self.assertTrue(request.full_url.endswith("/v1/firmware/3.3.3/Terra%20AC/false"))
        self.assertEqual(request.get_header("Clientid"), "ctp")

    @patch("backend.services.fota_service.urlopen")
    def test_prev_fota_origin_is_configured_for_reads(self, urlopen):
        urlopen.return_value = mock_response({"data": {"content": [], "totalElements": 0}})

        list_packages("prev", "synthetic-test-token")

        request = urlopen.call_args.args[0]
        self.assertEqual(urlparse(request.full_url).path, "/v1/firmware")
        self.assertEqual(request.get_header("Origin"), "https://tme-ev-chargingplatform-fota-webapp-prev.toyota-europe.com")

    @patch("backend.services.fota_service.urlopen")
    def test_filter_metadata_uses_observed_tme_client_header(self, urlopen):
        urlopen.return_value = mock_response({"data": {}})

        metadata = get_filter_metadata("acc", "synthetic-test-token")

        self.assertEqual(set(metadata), {"models", "versions", "statuses", "countries"})
        self.assertEqual(urlopen.call_count, 4)
        headers_by_path = {}
        for call in urlopen.call_args_list:
            request = call.args[0]
            self.assertEqual(request.get_method(), "GET")
            headers_by_path[urlparse(request.full_url).path] = request.get_header("Clientid")

        self.assertEqual(headers_by_path, {
            "/v1/wallboxes/models": "tme",
            "/v1/firmwares/version": "tme",
            "/v1/wallboxes/connectors/0/status": "tme",
            "/v1/fota/countries": "ctp",
        })

    @patch("backend.services.fota_service.urlopen")
    def test_model_matrix_uses_observed_ctp_client_header(self, urlopen):
        urlopen.return_value = mock_response({"data": {"content": [], "totalElements": 0}})

        get_model_matrix("acc", "synthetic-test-token")

        request = urlopen.call_args.args[0]
        self.assertEqual(request.get_method(), "GET")
        self.assertEqual(urlparse(request.full_url).path, "/v1/wallboxes/model")
        self.assertEqual(request.get_header("Clientid"), "ctp")


if __name__ == "__main__":
    unittest.main()