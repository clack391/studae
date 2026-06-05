import logging
import os

import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.logging import LoggingIntegration

_sentry_dsn = os.environ.get("SENTRY_DSN")
if _sentry_dsn:
    sentry_sdk.init(
        dsn=_sentry_dsn,
        environment=os.environ.get("SENTRY_ENVIRONMENT", "production"),
        traces_sample_rate=float(os.environ.get("SENTRY_TRACES_SAMPLE_RATE", "0.1")),
        integrations=[
            FastApiIntegration(),
            LoggingIntegration(level=logging.INFO, event_level=logging.ERROR),
        ],
    )

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    force=True,
)
