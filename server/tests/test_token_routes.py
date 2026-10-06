import base64
import json
import socket
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
        read_token.assert_called_once_with("acc", allow_browser_scan=False, app="fota")

    def test_session_token_can_scan_existing_browser_storage_on_request(self):
        with patch("server.read_saved_token", return_value="synthetic-browser-token") as read_token:
            status, payload = self.request_json(
                "GET", "/api/session-token?env=prod&app=charger&scanBrowser=1"
            )

        self.assertEqual(status, 200)
        self.assertEqual(payload["token"], "synthetic-browser-token")
        read_token.assert_called_once_with("prod", allow_browser_scan=True, app="charger")

    def test_chargedot_route_returns_sensitive_record_to_local_ui_only(self):
        manufacturer_record = {
            "serialNumber": "TACW2244723S0930",
            "model": "ChargeDot wallbox",
            "sensitiveData": {"pinCode": "synthetic-pin", "iccid": "synthetic-iccid"},
        }
        with patch("server.get_chargedot_data", return_value=manufacturer_record) as get_data:
            status, payload = self.request_json(
                "GET", "/api/chargedot/charger?serialNumber=TACW2244723S0930"
            )

        self.assertEqual(status, 200)
        self.assertEqual(payload["data"]["sensitiveData"], manufacturer_record["sensitiveData"])
        get_data.assert_called_once_with("TACW2244723S0930")

        with patch("server.get_chargedot_data") as get_data:
            remote_status, remote_payload = self.request_json(
                "GET",
                "/api/chargedot/charger?serialNumber=TACW2244723S0930",
                origin="https://attacker.example",
            )

        self.assertEqual(remote_status, 403)
        self.assertFalse(remote_payload["ok"])
        get_data.assert_not_called()

    def test_kubernetes_status_and_pod_inventory_are_available_to_local_ui(self):
        pod_inventory = {
            "env": "prod",
            "namespace": "all",
            "summary": {"total": 1, "healthy": 1},
            "pods": [{"namespace": "tme-ns-ev-backend-prd", "name": "api-0", "health": "Healthy"}],
        }
        infrastructure = {"env": "prod", "namespace": "all", "nodes": [{"name": "node-1"}]}
        with patch("server.get_kubernetes_credential_status", return_value={
            "env": "prod", "authenticated": True, "status": "ready"
        }) as get_status, patch("server.list_kubernetes_pods", return_value=pod_inventory) as get_pods, patch(
            "server.get_kubernetes_node_infrastructure", return_value=infrastructure
        ) as get_infrastructure:
            status_code, status_payload = self.request_json("GET", "/api/kubernetes/status?env=prod")
            pods_code, pods_payload = self.request_json(
                "GET", "/api/kubernetes/pods?env=prod&namespace=all"
            )
            infra_code, infra_payload = self.request_json(
                "GET", "/api/kubernetes/infrastructure?env=prod&namespace=all"
            )
            forced_code, _ = self.request_json(
                "GET", "/api/kubernetes/infrastructure?env=prod&namespace=all&refresh=true"
            )

        self.assertEqual(status_code, 200)
        self.assertTrue(status_payload["authenticated"])
        self.assertEqual(pods_code, 200)
        self.assertEqual(pods_payload["pods"][0]["name"], "api-0")
        self.assertEqual(infra_code, 200)
        self.assertEqual(infra_payload["nodes"][0]["name"], "node-1")
        self.assertEqual(forced_code, 200)
        get_status.assert_called_once_with("prod")
        get_pods.assert_called_once_with("prod", "all")
        self.assertEqual([call.args for call in get_infrastructure.call_args_list], [("prod", "all", False), ("prod", "all", True)])

    def test_kubernetes_routes_forward_each_selected_nonproduction_environment(self):
        environments = ("dev", "prev", "acc")
        with patch("server.get_kubernetes_credential_status", side_effect=lambda env: {
            "env": env, "authenticated": True, "status": "ready"
        }) as get_status, patch("server.list_kubernetes_pods", side_effect=lambda env, namespace: {
            "env": env, "namespace": namespace, "pods": []
        }) as get_pods:
            for env in environments:
                status_code, status_payload = self.request_json("GET", f"/api/kubernetes/status?env={env}")
                pods_code, pods_payload = self.request_json(
                    "GET", f"/api/kubernetes/pods?env={env}&namespace=all"
                )
                self.assertEqual(status_code, 200)
                self.assertEqual(status_payload["env"], env)
                self.assertEqual(pods_code, 200)
                self.assertEqual(pods_payload["env"], env)

        self.assertEqual([call.args[0] for call in get_status.call_args_list], list(environments))
        self.assertEqual([call.args for call in get_pods.call_args_list], [(env, "all") for env in environments])

    def test_kubernetes_routes_reject_remote_origins_before_aws_access(self):
        with patch("server.get_kubernetes_credential_status") as get_status, \
                patch("server.list_kubernetes_pods") as get_pods, \
            patch("server.get_kubernetes_node_infrastructure") as get_infrastructure, \
                patch("server.start_kubernetes_sso_login") as start_login:
            status_code, _ = self.request_json(
                "GET", "/api/kubernetes/status?env=prod", origin="https://attacker.example"
            )
            pods_code, _ = self.request_json(
                "GET", "/api/kubernetes/pods?env=prod&cluster=backend", origin="https://attacker.example"
            )
            infra_code, _ = self.request_json(
                "GET", "/api/kubernetes/infrastructure?env=prod&namespace=all", origin="https://attacker.example"
            )
            login_code, _ = self.request_json(
                "POST", "/api/kubernetes/login?env=prod", origin="https://attacker.example"
            )

        self.assertEqual((status_code, pods_code, infra_code, login_code), (403, 403, 403, 403))
        get_status.assert_not_called()
        get_pods.assert_not_called()
        get_infrastructure.assert_not_called()
        start_login.assert_not_called()

    def test_kubernetes_terminal_requires_local_origin_and_websocket_upgrade(self):
        path = "/api/kubernetes/terminal?env=prod&namespace=tme-ns-ev-backend-prd&pod=api-0&container=api"
        with patch("server.start_kubernetes_pod_terminal") as start_terminal:
            remote_status, _ = self.request_json("GET", path, origin="https://attacker.example")
            invalid_upgrade_status, _ = self.request_json("GET", path)

        self.assertEqual(remote_status, 403)
        self.assertEqual(invalid_upgrade_status, 400)
        start_terminal.assert_not_called()

    def test_kubernetes_terminal_upgrades_and_closes_the_session(self):
        path = "/api/kubernetes/terminal?env=prod&namespace=tme-ns-ev-backend-prd&pod=api-0&container=api"
        session = unittest.mock.MagicMock()
        session.process.stdout = BytesIO(b"shell ready\n")
        session.process.stdin = BytesIO()
        session.process.poll.return_value = None
        closed = threading.Event()
        session.close.side_effect = closed.set
        websocket_key = base64.b64encode(b"0123456789abcdef").decode("ascii")
        with patch("server.start_kubernetes_pod_terminal", return_value=session) as start_terminal:
            client = socket.create_connection(("127.0.0.1", self.httpd.server_port), timeout=3)
            client.sendall((
                f"GET {path} HTTP/1.1\r\n"
                f"Host: localhost:{self.httpd.server_port}\r\n"
                "Origin: http://localhost:4200\r\n"
                "Connection: Upgrade\r\n"
                "Upgrade: websocket\r\n"
                "Sec-WebSocket-Version: 13\r\n"
                f"Sec-WebSocket-Key: {websocket_key}\r\n\r\n"
            ).encode("ascii"))
            response = client.recv(1024)
            self.assertIn(b"101 Switching Protocols", response)
            mask = b"abcd"
            close_payload = b"\x03\xe8"
            masked_close = bytes((0x88, 0x80 | len(close_payload))) + mask + bytes(
                value ^ mask[index % 4] for index, value in enumerate(close_payload)
            )
            client.sendall(masked_close)
            client.close()

            self.assertTrue(closed.wait(timeout=3))

        start_terminal.assert_called_once_with(
            "prod", "tme-ns-ev-backend-prd", "api-0", "api"
        )
        session.close.assert_called_once()

    def test_kubernetes_login_starts_sso_for_the_selected_environment(self):
        with patch("server.start_kubernetes_sso_login", return_value={
            "env": "acc", "started": True
        }) as start_login:
            status_code, payload = self.request_json("POST", "/api/kubernetes/login?env=acc")

        self.assertEqual(status_code, 200)
        self.assertTrue(payload["started"])
        start_login.assert_called_once_with("acc")

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

    def test_fota_capture_scans_existing_browser_sessions_without_forcing_fresh_login(self):
        with patch("server.read_saved_token", return_value="") as read_token, \
                patch("server.start_token_capture") as start_capture:
            status, payload = self.request_json("POST", "/api/refresh-tme-token?env=acc&app=fota")

        self.assertEqual(status, 200)
        self.assertEqual(payload["app"], "fota")
        self.assertTrue(payload["url"].endswith("/campaign/registry"))
        self.assertIn("fota-webapp-acc.toyota-europe.com", payload["url"])
        self.assertIn("existing browser sessions", payload["message"])
        read_token.assert_called_once_with("acc", allow_browser_scan=True, app="fota")
        kwargs = start_capture.call_args.kwargs
        self.assertEqual(kwargs["app"], "fota")
        self.assertFalse(kwargs["force"])
        self.assertEqual(kwargs["min_issued_at"], 0)

        body = {"token": "synthetic-fota-token", "env": "acc", "app": "fota"}
        with patch("server.store_captured_token", return_value=True) as store_token:
            callback_status, callback_payload = self.request_json("POST", "/api/tme-token?env=acc", body=body)

        self.assertEqual(callback_status, 200)
        self.assertEqual(callback_payload["app"], "fota")
        store_token.assert_called_once_with(body["token"], "acc", min_issued_at=0, app="fota")

    def test_fota_capture_ignores_force_so_existing_session_tokens_stay_acceptable(self):
        with patch("server.read_saved_token", return_value=""), \
                patch("server.start_token_capture") as start_capture:
            self.request_json("POST", "/api/refresh-tme-token?env=acc&app=fota&force=true")

        self.assertFalse(start_capture.call_args.kwargs["force"])
        self.assertEqual(start_capture.call_args.kwargs["min_issued_at"], 0)

    def test_preview_fota_capture_uses_the_configured_webapp(self):
        with patch("server.read_saved_token", return_value=""), \
                patch("server.start_token_capture") as start_capture:
            status, payload = self.request_json("POST", "/api/refresh-tme-token?env=prev&app=fota")

        self.assertEqual(status, 200)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["app"], "fota")
        self.assertEqual(
            payload["url"],
            "https://tme-ev-chargingplatform-fota-webapp-prev.toyota-europe.com/campaign/registry",
        )
        self.assertEqual(start_capture.call_args.kwargs["app"], "fota")

    def test_fota_model_matrix_route_uses_the_saved_fota_token(self):
        matrix = {"data": {"content": [], "totalElements": 0}}
        with patch("server.read_saved_token", return_value="synthetic-fota-token"), \
                patch("server.get_model_matrix", return_value=matrix) as get_matrix:
            status, payload = self.request_json("GET", "/api/fota/model-matrix?env=acc")

        self.assertEqual(status, 200)
        self.assertEqual(payload["data"], matrix["data"])
        get_matrix.assert_called_once_with("acc", "synthetic-fota-token")


if __name__ == "__main__":
    unittest.main()