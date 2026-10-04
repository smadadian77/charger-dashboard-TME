import base64
import json
import os
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import tme_token_bridge as bridge
from tme_token_bridge import (
    TME_CLIENT_IDS,
    extract_jwts,
    extract_utf16_jwts,
    _stale_profile_process_query,
    pick_dashboard_token,
    pick_valid_tme_token,
)


def synthetic_jwt():
    def encode(value):
        return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip("=")

    return f"{encode({'alg': 'none', 'typ': 'JWT'})}.{encode({'aud': 'synthetic-client', 'exp': 2000000000})}.synthetic_signature"


def synthetic_tme_jwt(issued_at):
    def encode(value):
        return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip("=")

    payload = {"aud": next(iter(TME_CLIENT_IDS)), "iat": issued_at, "exp": issued_at + 3600}
    return f"{encode({'alg': 'none', 'typ': 'JWT'})}.{encode(payload)}.synthetic_signature"


class TokenBridgeExtractionTests(unittest.TestCase):
    def test_extracts_utf16_local_storage_jwt(self):
        token = synthetic_jwt()
        raw_storage_value = ("{" + token + "}").encode("utf-16le")

        self.assertIn(token, extract_utf16_jwts(raw_storage_value))
        self.assertIn(token, extract_jwts(raw_storage_value))

    def test_extracts_ascii_leveldb_jwt(self):
        token = synthetic_jwt()
        self.assertIn(token, extract_jwts(token.encode("ascii")))

    def test_force_refresh_picker_ignores_old_disk_and_intercepted_tokens(self):
        threshold = 1_900_000_000
        old_token = synthetic_tme_jwt(threshold - 60)
        fresh_token = synthetic_tme_jwt(threshold + 1)

        self.assertEqual(pick_dashboard_token([old_token, fresh_token], min_iat=threshold), fresh_token)
        self.assertEqual(pick_valid_tme_token([old_token, fresh_token], min_iat=threshold), fresh_token)
        self.assertIsNone(pick_dashboard_token([old_token], min_iat=threshold))
        self.assertIsNone(pick_valid_tme_token([old_token], min_iat=threshold))

    def test_force_refresh_disk_scan_propagates_min_iat(self):
        threshold = 1_900_000_000
        old_token = synthetic_tme_jwt(threshold - 60)
        fresh_token = synthetic_tme_jwt(threshold + 1)
        raw_storage = (old_token + " " + fresh_token).encode("utf-16le")

        with tempfile.TemporaryDirectory() as directory:
            with open(os.path.join(directory, "000001.ldb"), "wb") as handle:
                handle.write(b"synthetic")
            with patch.object(bridge, "storage_dirs", return_value=[directory]), \
                    patch.object(bridge, "read_shared", return_value=raw_storage):
                captured = bridge.find_dashboard_token(include_ldb=True, min_iat=threshold)

        self.assertEqual(captured, fresh_token)

    def test_force_refresh_page_storage_rejects_old_token_but_saves_fresh_one(self):
        threshold = 1_900_000_000
        old_token = synthetic_tme_jwt(threshold - 60)
        fresh_token = synthetic_tme_jwt(threshold + 1)
        page = SimpleNamespace(url="https://synthetic.invalid/")
        context = SimpleNamespace()

        class StopPolling(Exception):
            pass

        common_patches = (
            patch.object(bridge, "MIN_ISSUED_AT", threshold),
            patch.object(bridge, "open_pages", return_value=[page]),
            patch.object(bridge, "attach_token_capture"),
            patch.object(bridge, "goto_dashboard", return_value=True),
            patch.object(bridge, "context_alive", return_value=True),
            patch.object(bridge, "log"),
        )

        with common_patches[0], common_patches[1], common_patches[2], common_patches[3], common_patches[4], common_patches[5], \
                patch.object(bridge, "read_page_tokens", return_value=[old_token]), \
                patch.object(bridge, "save_token_to_local_server") as save_token, \
                patch.object(bridge.time, "sleep", side_effect=StopPolling):
            with self.assertRaises(StopPolling):
                bridge.poll_for_token(context, None)
            save_token.assert_not_called()

        with common_patches[0], common_patches[1], common_patches[2], common_patches[3], common_patches[4], common_patches[5], \
                patch.object(bridge, "read_page_tokens", return_value=[fresh_token]), \
                patch.object(bridge, "save_token_to_local_server", return_value=(200, "{\"ok\":true}")) as save_token:
            self.assertEqual(bridge.poll_for_token(context, None), 0)
            save_token.assert_called_once_with(fresh_token)

    def test_no_browser_mode_never_opens_or_reopens_auth_tab(self):
        class StopPolling(Exception):
            pass

        with patch.object(bridge, "FORCE", True), \
                patch.object(bridge, "NO_BROWSER", True), \
                patch.object(bridge, "find_dashboard_token", return_value=None), \
                patch.object(bridge, "open_tme_tab") as open_tab, \
                patch.object(bridge, "log"), \
                patch.object(bridge.time, "sleep", side_effect=StopPolling):
            with self.assertRaises(StopPolling):
                bridge.main()
        open_tab.assert_not_called()

    def test_stale_process_query_is_scoped_to_the_environment_profile(self):
        profile_root = r"C:\Local App Data\TMEWallboxBridge_ACC"
        command = _stale_profile_process_query(profile_root)

        self.assertIn(profile_root, command)
        self.assertIn("CommandLine.Contains($profileRoot)", command)
        self.assertNotIn("-match 'TMEWallboxBridge'", command)


if __name__ == "__main__":
    unittest.main()