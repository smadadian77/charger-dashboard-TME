import os

# Project root directory
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(BACKEND_DIR)

DEFAULT_PORT = 8000
SERIAL_HISTORY_FILE = os.path.join(BASE_DIR, "serial_history.json")

ENV_CONFIGS = {
    "prod": {
        "api_host": "https://tme-ev-chargingplatform.toyota-europe.com",
        "webapp_origin": "https://tme-ev-chargingplatform-charger-dashboard-webapp.toyota-europe.com",
        "token_file": "tme_session_token.json",
        "label": "PROD",
    },
    "acc": {
        "api_host": "https://tme-ev-chargingplatform-acc.toyota-europe.com",
        "webapp_origin": "https://tme-ev-chargingplatform-charger-dashboard-webapp-acc.toyota-europe.com",
        "token_file": "tme_session_token_acc.json",
        "label": "ACC",
    },
    "prev": {
        "api_host": "https://tme-ev-chargingplatform-prev.toyota-europe.com",
        "webapp_origin": "https://tme-ev-chargingplatform-charger-dashboard-webapp-prev.toyota-europe.com",
        "token_file": "tme_session_token_prev.json",
        "label": "PREV",
    },
}

TME_API_ORIGIN = ENV_CONFIGS["prod"]["api_host"]


def normalize_env(env):
    env_str = str(env or "").strip().lower()
    return env_str if env_str in ENV_CONFIGS else "prod"


def get_env_config(env="prod"):
    return ENV_CONFIGS[normalize_env(env)]


def get_token_file(env="prod"):
    return os.path.join(BASE_DIR, get_env_config(env)["token_file"])


def get_api_url(path, env="prod"):
    clean_path = path if path.startswith("/") else f"/{path}"
    return f"{get_env_config(env)['api_host']}{clean_path}"


def get_dashboard_url(env="prod"):
    return f"{get_env_config(env)['webapp_origin']}/wallbox/list"

