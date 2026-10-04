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

FOTA_WEBAPP_ORIGINS = {
    "prod": "https://tme-ev-chargingplatform-fota-webapp.toyota-europe.com",
    "acc": "https://tme-ev-chargingplatform-fota-webapp-acc.toyota-europe.com",
}
FOTA_WEBAPP_PATH = "/wallbox/listfo"

TME_API_ORIGIN = ENV_CONFIGS["prod"]["api_host"]


def normalize_env(env):
    env_str = str(env or "").strip().lower()
    return env_str if env_str in ENV_CONFIGS else "prod"


def get_env_config(env="prod"):
    return ENV_CONFIGS[normalize_env(env)]


def normalize_token_app(app="charger"):
    return "fota" if str(app or "").strip().lower() == "fota" else "charger"


def get_token_file(env="prod", app="charger"):
    filename = get_env_config(env)["token_file"]
    if normalize_token_app(app) == "fota":
        name, extension = os.path.splitext(filename)
        filename = f"{name}_fota{extension}"
    return os.path.join(BASE_DIR, filename)


def get_api_url(path, env="prod"):
    clean_path = path if path.startswith("/") else f"/{path}"
    return f"{get_env_config(env)['api_host']}{clean_path}"


def get_dashboard_url(env="prod"):
    return f"{get_env_config(env)['webapp_origin']}/wallbox/list"


def get_fota_webapp_origin(env="prod"):
    return FOTA_WEBAPP_ORIGINS.get(normalize_env(env))


def get_fota_webapp_url(env="prod"):
    origin = get_fota_webapp_origin(env)
    return f"{origin}{FOTA_WEBAPP_PATH}" if origin else None

