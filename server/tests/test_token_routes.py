import json
import threading
import unittest
from io import BytesIO
from email.message import Message
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from unittest.mock import patch

import server as app_server


class TokenRouteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), app_server.AppHandler)
        cls.httpd.daemon_threads = True
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()
        cls.base_url = f"http://127.0.0.1:{cls.httpd.server_port}"
    
    def setUp(self):
        with app_server.TOKEN_CAPTURE_FRESHNESS_LOCK:
            app_server.TOKEN_CAPTURE_FRESHNESS.clear()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join(timeout=2)

    def request_json(self, method, path, origin="http://localhost:4200", body=None, headers=None):
        encoded_body = json.dumps(body).encode("utf-8") if body is not None else None
        request_headers = {"Origin": origin, "Content-Type": "application/json"}
        if headers:
            request_headers.update(headers)
        request = Request(
            f"{self.base_url}{path}",
            data=encoded_body,
            headers=request_headers,
            method=method,
        )
        try:
            with urlopen(request, timeout=3) as response:
                return response.status, json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            return error.code, json.loads(error.read().decode("utf-8"))

    def test_token_status_never_returns_raw_token(self):
        with patch("server.get_token_status", return_value={
            "ok": True,
            "env": "prod",
            "status": "valid",
            "valid": True,
            "hasToken": True,
            "minutesRemaining": 30,
        }), patch("server.get_dashboard_url", return_value="http://localhost/"):
            status, payload = self.request_json("GET", "/api/token-status?env=prod")

        self.assertEqual(status, 200)
        self.assertNotIn("token", payload)

    def test_session_token_returns_only_the_saved_environment_token_to_local_ui(self):
        synthetic_token = "synthetic-prod-token"
        with patch("server.read_saved_token", return_value=synthetic_token):
            status, payload = self.request_json("GET", "/api/session-token?env=prod")

        self.assertEqual(status, 200)
        self.assertEqual(payload["token"], synthetic_token)
        self.assertEqual(payload["env"], "prod")

    def test_session_token_selects_the_fota_store(self):
        with patch("server.read_saved_token", return_value="synthetic-fota-token") as read_token:
            status, payload = self.request_json("GET", "/api/session-token?env=acc&app=fota")

        self.assertEqual(status, 200)
        self.assertEqual(payload["app"], "fota")
        read_token.assert_called_once_with("acc", app="fota")

    def test_token_routes_reject_remote_origins_before_reading_token(self):
        with patch("server.read_saved_token") as read_token, \
                patch("server.start_token_capture") as start_capture:
            status, payload = self.request_json(
                "GET", "/api/session-token?env=prod", origin="https://attacker.example"
            )
            refresh_status, refresh_payload = self.request_json(
                "POST", "/api/refresh-tme-token?env=prod&force=true", origin="https://attacker.example"
            )

        self.assertEqual(status, 403)
        self.assertFalse(payload["ok"])
        self.assertEqual(refresh_status, 403)
        self.assertFalse(refresh_payload["ok"])
        read_token.assert_not_called()
        start_capture.assert_not_called()

    def test_session_token_get_does_not_honor_legacy_delete_override(self):
        synthetic_token = "synthetic-valid-token"
        with patch("server.read_saved_token", return_value=synthetic_token), \
                patch("server.delete_saved_token") as delete_token:
            status, payload = self.request_json(
                "GET", "/api/session-token?env=prod", headers={"X-Method-Override": "DELETE"}
            )

        self.assertEqual(status, 200)
        self.assertEqual(payload["token"], synthetic_token)
        delete_token.assert_not_called()

    def test_refresh_get_is_read_only_and_post_starts_capture(self):
        with patch("server.start_token_capture") as start_capture, \
                patch("server.delete_saved_token") as delete_token, \
                patch("server.webbrowser.open", return_value=True) as open_browser:
            get_status, _ = self.request_json("GET", "/api/refresh-tme-token?env=acc&force=true")
            self.assertEqual(get_status, 405)
            start_capture.assert_not_called()

            post_status, payload = self.request_json(
                "POST", "/api/refresh-tme-token?env=acc&force=true&noBrowser=1&openBrowser=1"
            )

        self.assertEqual(post_status, 200)
        self.assertTrue(payload["capturing"])
        self.assertTrue(payload["browserOpened"])
        open_browser.assert_called_once()
        kwargs = start_capture.call_args.kwargs
        self.assertEqual(kwargs["force"], True)
        self.assertEqual(kwargs["no_browser"], True)
        self.assertGreater(kwargs["min_issued_at"], 0)
        cutoff = kwargs["min_issued_at"]
        callback_body = {"token": "synthetic-older-capture", "env": "acc"}
        with patch("server.store_captured_token", return_value=False) as store_token:
            callback_status, _ = self.request_json("POST", "/api/tme-token?env=acc", body=callback_body)

        self.assertEqual(callback_status, 400)
        store_token.assert_called_once_with(callback_body["token"], "acc", min_issued_at=cutoff, app="charger")

    def test_rejected_captured_token_does_not_delete_saved_token(self):
        body = {"token": "synthetic-wrong-environment-token", "env": "prod"}
        with patch("server.store_captured_token", return_value=False) as store_token, \
                patch("server.delete_saved_token") as delete_token:
            status, payload = self.request_json("POST", "/api/tme-token?env=prod", body=body)

        self.assertEqual(status, 400)
        self.assertFalse(payload["ok"])
        store_token.assert_called_once_with(body["token"], "prod", min_issued_at=0, app="charger")
        delete_token.assert_not_called()

    def test_callback_rejects_remote_origin_before_token_validation(self):
        with patch("server.store_captured_token") as store_token:
            status, payload = self.request_json(
                "POST",
                "/api/tme-token?env=prod",
                origin="https://attacker.example",
                body={"token": "synthetic-token", "env": "prod"},
            )

        self.assertEqual(status, 403)
        self.assertFalse(payload["ok"])
        store_token.assert_not_called()

    def test_wallbox_list_upstream_401_preserves_saved_token(self):
        upstream_error = HTTPError("https://upstream.invalid/wallboxes", 401, "Unauthorized", Message(), BytesIO(b"{}"))
        with patch("server.read_saved_token", return_value="synthetic-saved-token"), \
                patch("server.urlopen", side_effect=upstream_error), \
                patch("server.delete_saved_token") as delete_token:
            status, payload = self.request_json("GET", "/api/wallbox-list?env=prod")

        self.assertEqual(status, 401)
        self.assertTrue(payload["authError"])
        self.assertTrue(payload["hasToken"])
        delete_token.assert_not_called()

    def test_captured_token_callback_saves_only_through_validated_store(self):
        body = {"token": "synthetic-environment-matched-token", "env": "acc"}
        with patch("server.store_captured_token", return_value=True) as store_token:
            status, payload = self.request_json("POST", "/api/tme-token?env=acc", body=body)

        self.assertEqual(status, 200)
        self.assertTrue(payload["ok"])
        self.assertNotIn("token", payload)
        store_token.assert_called_once_with(body["token"], "acc", min_issued_at=0, app="charger")

    def test_fota_capture_uses_fota_url_store_and_freshness_boundary(self):
        with patch("server.read_saved_token", return_value=""), \
                patch("server.start_token_capture") as start_capture:
            status, payload = self.request_json("POST", "/api/refresh-tme-token?env=acc&app=fota")

        self.assertEqual(status, 200)
        self.assertEqual(payload["app"], "fota")
        self.assertTrue(payload["url"].endswith("/wallbox/listfo"))
        self.assertIn("fota-webapp-acc.toyota-europe.com", payload["url"])
        kwargs = start_capture.call_args.kwargs
        self.assertEqual(kwargs["app"], "fota")
        self.assertTrue(kwargs["force"])
        cutoff = kwargs["min_issued_at"]

        body = {"token": "synthetic-fota-token", "env": "acc", "app": "fota"}
        with patch("server.store_captured_token", return_value=True) as store_token:
            callback_status, callback_payload = self.request_json("POST", "/api/tme-token?env=acc", body=body)

        self.assertEqual(callback_status, 200)
        self.assertEqual(callback_payload["app"], "fota")
        store_token.assert_called_once_with(body["token"], "acc", min_issued_at=cutoff, app="fota")

    def test_fota_capture_fails_closed_for_unconfigured_preview(self):
        with patch("server.start_token_capture") as start_capture:
            status, payload = self.request_json("POST", "/api/refresh-tme-token?env=prev&app=fota")

        self.assertEqual(status, 501)
        self.assertFalse(payload["ok"])
        self.assertIn("not configured", payload["message"])
        start_capture.assert_not_called()


if __name__ == "__main__":
    unittest.main()