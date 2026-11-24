# REPO MAP

## Paths

CLIENT_DIR=client
SERVER_DIR=server
STATS_DIR=stats-service

## Server

PACKAGE_MANAGER=npm
NODE_VERSION=20+
MODULE_SYSTEM=ESM
LANGUAGE=JavaScript (ESM)
SCRIPTS=start: node server.js, dev: nodemon server.js, lint: eslint
ENTRY_FILE=server.js
EXPRESS_VERSION=5.3.0
ROUTER_MOUNT_NOTES=server.js mounts ./src/app.js at /api/v1; app.js mounts auth, user, datasets, forecast, assumptions, optimization, simulations, replay, portfolio, sessions, jobs, and ai routers
PORT_ENV_VAR=PORT
PORT_DEFAULT=8000
AUTH_MIDDLEWARE_FILE=server/src/middlewares/auth.middleware.js
AUTH_MIDDLEWARE_EXPORT=authMiddleware
AUTH_REQ_PROPERTY=req.user (Mongoose User document object), res.locals.user.userId
USER_MODEL=server/src/models/user.model.js
USER_UID_FIELD=firebaseUid
DB_LAYER=mongoose (version 9.12.2)
DB_CONNECTION_FILE=server/src/config/db.js
MONGO_URI_ENV_VAR=MONGODB_URI (fallback: MONGO_URI)
LOGGER=morgan (console)
ERROR_HANDLER_FILE=server/src/middlewares/error.middleware.js
ENV_LOADING=dotenv

## Client

PACKAGE_MANAGER=npm
VITE_VERSION=8.3.6
TAILWIND_VERSION=4.3.5
REACT_VERSION=19.3.1
REDUX_TOOLKIT_VERSION=2.14.0
ROUTER_LIB=react-router-dom@7.18.5
RECHARTS_VERSION=3.11.0
STORE_FILE=client/src/redux/store.js
ROUTES_FILE=client/src/App.jsx
EXISTING_ROUTES=/login, /, /sessions, /sessions/:sessionId (children: overview, upload, validation, forecast, assumptions, optimization, simulation, portfolio, summary), /ask-ai, /ask-ai/:conversationId, * (NotFound)
FIREBASE_INIT_FILE=client/src/utils/firebase.js
API_CLIENT_FILE=client/src/lib/api.js (RTK Query), client/src/utils/axios.js (axios instance)
UI_PRIMITIVES=Lucide icons (lucide-react@1.75.0), Tailwind CSS utility classes

## Stats Service

LANGUAGE=Python 3.11+
FRAMEWORK=FastAPI 0.165.0 / Uvicorn 0.54.0
ENTRY_FILE=stats-service/app/main.py
PORT_DEFAULT=8001
SHARED_SECRET_HEADER=X-Service-Key
CORE_LIBRARIES=statsforecast==2.1.1, lightgbm==4.7.0, scipy==1.17.1, numpy==2.4.6, pandas==2.3.3, pydantic==2.14.3, scikit-learn==1.9.1, matplotlib==3.11.2

## Baseline

SERVER_BUILD_STATUS=pass
CLIENT_BUILD_STATUS=pass
PRE_EXISTING_ERRORS=none
