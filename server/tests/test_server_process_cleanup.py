import unittest

from server import build_dashboard_process_cleanup_script


class DashboardProcessCleanupTests(unittest.TestCase):
    def test_cleanup_matches_only_known_dashboard_process_paths(self):
        script = build_dashboard_process_cleanup_script(8000, 1234)

        self.assertIn("server.py", script)
        self.assertIn("launcher.py", script)
        self.assertIn("server/server.py", script)
        self.assertIn("$relativeDashboardScript", script)
        self.assertIn("ChargerDashboardAngular.exe", script)
        self.assertIn("$foreignOwners.Count -gt 0", script)
        self.assertIn("exit 2", script)
        self.assertIn("$currentPid = 1234", script)
        self.assertIn("$cleanupPid = $PID", script)
        self.assertIn("$_.ProcessId -ne $cleanupPid", script)
        self.assertIn("$activeDashboardOwners.Count -gt 0", script)
        self.assertIn("exit 3", script)
        self.assertNotIn("Stop-Process", script)


if __name__ == "__main__":
    unittest.main()