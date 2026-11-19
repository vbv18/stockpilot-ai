# REPO MAP
## Paths
CLIENT_DIR=client
SERVER_DIR=server
STATS_DIR=stats-service
## Server
PACKAGE_MANAGER=npm
NODE_VERSION=v26.10.0
MODULE_SYSTEM=ESM
TS_STRICT=NOT APPLICABLE (JavaScript project)
SCRIPTS=build: none, dev: dev (nodemon server.js), typecheck/lint: lint (eslint)
ENTRY_FILE=server.js
EXPRESS_VERSION=5.3.0
ROUTER_MOUNT_NOTES=server.js mounts ./src/app.js at /api/v1; app.js mounts /auth and /user with asyncHandler, authMiddleware between them, then notFoundMiddleware and errorMiddleware
PORT_ENV_VAR=PORT
PORT_DEFAULT=8000
AUTH_MIDDLEWARE_FILE=src/middlewares/auth.middleware.js
AUTH_MIDDLEWARE_EXPORT=default
AUTH_REQ_PROPERTY=req.user (Mongoose User document object)
USER_MODEL=src/models/user.model.js
USER_UID_FIELD=firebaseUid
DB_LAYER=mongoose
DB_CONNECTION_FILE=src/config/db.js
MONGO_URI_ENV_VAR=MONGO_URI
LOGGER=morgan (console)
ERROR_HANDLER_FILE=src/middlewares/error.middleware.js
ENV_LOADING=dotenv
## Client
PACKAGE_MANAGER=npm
VITE_VERSION=8.3.6
TAILWIND_VERSION=4.3.5
REACT_VERSION=19.3.1
STORE_FILE=src/redux/store.js
TYPED_HOOKS_FILE=NOT APPLICABLE (JavaScript project, uses useSelector/useDispatch from react-redux)
ROUTER_LIB=react-router-dom@7.18.5
ROUTES_FILE=src/App.jsx
EXISTING_ROUTES=/login, /, *
FIREBASE_INIT_FILE=src/utils/firebase.js
GET_ID_TOKEN=(await loginData.user.getIdToken()) or (await auth.currentUser.getIdToken())
API_CLIENT_FILE=src/utils/axios.js (export const api)
UI_PRIMITIVES=Lucide icons, FcGoogle, inline Tailwind classes with dark palette (#0d0f14, #13151c, border-white/[0.08])
RECHARTS_INSTALLED=false
## Baseline
SERVER_BUILD_STATUS=pass
CLIENT_BUILD_STATUS=pass
PRE_EXISTING_ERRORS=none
## Tooling
PYTHON_VERSION=Python 3.11.7
DOCKER=Docker version 29.7.2, Docker Compose version v5.3.1
