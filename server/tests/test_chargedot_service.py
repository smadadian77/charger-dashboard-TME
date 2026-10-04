import unittest

from backend.services.chargedot_service import _public_record


class ChargeDotServiceTests(unittest.TestCase):
    def test_public_record_contains_requested_sensitive_fields_and_excludes_unknown_fields(self):
        payload = {
            "serialNumber": "TACW2244723S0930",
            "model": "ChargeDot wallbox",
            "pinCode": "synthetic-pin",
            "imei": "synthetic-imei",
            "iccid": "synthetic-iccid",
            "preProgrammedRfidCards": ["synthetic-rfid-card"],
            "unrelatedCredential": "must-not-be-returned",
        }

        record = _public_record(payload, payload["serialNumber"])

        self.assertEqual(record["model"], payload["model"])
        self.assertEqual(record["sensitiveData"], {
            "pinCode": "synthetic-pin",
            "imei": "synthetic-imei",
            "iccid": "synthetic-iccid",
            "preProgrammedRfidCards": ["synthetic-rfid-card"],
        })
        self.assertEqual(record["preProgrammedRfidCardCount"], 1)
        self.assertNotIn("unrelatedCredential", record)


if __name__ == "__main__":
    unittest.main()