This is a new [**React Native**](https://reactnative.dev) project, bootstrapped using [`@react-native-community/cli`](https://github.com/react-native-community/cli).

# Getting Started

> **Note**: Make sure you have completed the [Set Up Your Environment](https://reactnative.dev/docs/set-up-your-environment) guide before proceeding.

## Step 1: Start Metro

First, you will need to run **Metro**, the JavaScript build tool for React Native.

To start the Metro dev server, run the following command from the root of your React Native project:

```sh
# Using npm
npm start

# OR using Yarn
yarn start
```

## Step 2: Build and run your app

With Metro running, open a new terminal window/pane from the root of your React Native project, and use one of the following commands to build and run your Android or iOS app:

### Android

```sh
# Using npm
npm run android

# OR using Yarn
yarn android
```

### iOS

For iOS, remember to install CocoaPods dependencies (this only needs to be run on first clone or after updating native deps).

The first time you create a new project, run the Ruby bundler to install CocoaPods itself:

```sh
bundle install
```

Then, and every time you update your native dependencies, run:

```sh
bundle exec pod install
```

For more information, please visit [CocoaPods Getting Started guide](https://guides.cocoapods.org/using/getting-started.html).

```sh
# Using npm
npm run ios

# OR using Yarn
yarn ios
```

If everything is set up correctly, you should see your new app running in the Android Emulator, iOS Simulator, or your connected device.

This is one way to run your app — you can also build it directly from Android Studio or Xcode.

## Step 3: Modify your app

Now that you have successfully run the app, let's make changes!

Open `App.tsx` in your text editor of choice and make some changes. When you save, your app will automatically update and reflect these changes — this is powered by [Fast Refresh](https://reactnative.dev/docs/fast-refresh).

When you want to forcefully reload, for example to reset the state of your app, you can perform a full reload:

- **Android**: Press the <kbd>R</kbd> key twice or select **"Reload"** from the **Dev Menu**, accessed via <kbd>Ctrl</kbd> + <kbd>M</kbd> (Windows/Linux) or <kbd>Cmd ⌘</kbd> + <kbd>M</kbd> (macOS).
- **iOS**: Press <kbd>R</kbd> in iOS Simulator.

## Congratulations! :tada:

You've successfully run and modified your React Native App. :partying_face:

### Now what?

- If you want to add this new React Native code to an existing application, check out the [Integration guide](https://reactnative.dev/docs/integration-with-existing-apps).
- If you're curious to learn more about React Native, check out the [docs](https://reactnative.dev/docs/getting-started).

# Troubleshooting

If you're having issues getting the above steps to work, see the [Troubleshooting](https://reactnative.dev/docs/troubleshooting) page.

# Learn More

To learn more about React Native, take a look at the following resources:

- [React Native Website](https://reactnative.dev) - learn more about React Native.
- [Getting Started](https://reactnative.dev/docs/environment-setup) - an **overview** of React Native and how setup your environment.
- [Learn the Basics](https://reactnative.dev/docs/getting-started) - a **guided tour** of the React Native **basics**.
- [Blog](https://reactnative.dev/blog) - read the latest official React Native **Blog** posts.
- [`@facebook/react-native`](https://github.com/facebook/react-native) - the Open Source; GitHub **repository** for React Native.

---

# Demo Accounts for UI Testing & Collaboration

For rapid UI testing across both the mobile application (offline SQLite) and the FastAPI backend (PostgreSQL), pre-configured demo accounts are provided for the **USTP Innovators Lab** organization.

### 🏢 Workspace Details
- **Organization Name**: `USTP Innovators Lab`
- **Subscription Plan**: `business` (Active, 5-seat capacity)
- **Timezone**: `Asia/Manila`
- **Shared Password (All Demo Accounts)**: `Password123!`

---

### 👥 Demo Account Credentials

| Account Role | Email Address | Password | Display Name | Permissions & UI Shell |
|---|---|---|---|---|
| **Employer / Manager** | `manager@lafina.ph` | `Password123!` | Dr. Eleanor Vance | **Manager Shell** (`Overview`, `Work`, `Chat`, `Inbox`): Create & assign multi-member tasks, schedule shifts/work blocks with conflict warnings, review & approve/reopen employee submissions with feedback, manage team seats & invites. |
| **Employee 1** | `alice@lafina.ph` | `Password123!` | Alice Guo | **Employee Shell** (`Today`, `Work`, `Chat`, `Inbox`): Active shift ("Morning Research Shift"), assigned tasks ("Deploy Edge Server Firewall", "Calibrate Oscilloscopes"), status progression (`in_progress` $\rightarrow$ `pending_review`), offline reminder calls. |
| **Employee 2** | `bob@lafina.ph` | `Password123!` | Bob Santos | **Employee Shell** (`Today`, `Work`, `Chat`, `Inbox`): Active shift ("Lab Hardware Maintenance"), assigned tasks ("Submit Q3 Hardware Inventory", "Deploy Edge Server Firewall"), interactive Notes to-dos. |

---

### 🔄 Database Synchronization (Local SQLite & FastAPI PostgreSQL)

The demo accounts, workspace memberships, and sample collaborative tasks are fully synchronized across both databases:

1. **Local SQLite (On-Device / Offline)**:
   - Automatically seeded on app initialization via `initDatabase()`.
   - Allows instant offline login with full business capabilities cache even without network connectivity.

2. **FastAPI & PostgreSQL (Cloud Backend)**:
   - To re-seed or ensure your cloud database is up to date, execute:
     ```sh
     python backend/scripts/seed_demo_accounts.py
     ```

---

### 🧪 Suggested Testing Workflows

1. **Test Manager Overview & Task Creation**:
   - Log into the app with `manager@lafina.ph` / `Password123!`.
   - View seat allocation (3/5 seats occupied) on the `Overview` tab.
   - Navigate to `Work` tab $\rightarrow$ Tap `+ Assign Task` $\rightarrow$ Select assignees (Alice, Bob) $\rightarrow$ Submit task.
2. **Test Shift Scheduling & Conflict Detection**:
   - In Manager shell, open `Work` tab $\rightarrow$ `Calendar` subtab $\rightarrow$ Tap `+ Shift`.
   - Try scheduling a block overlapping `09:00 - 13:00` for Alice to see the real-time collision warning banner.
3. **Test Employee Execution & Review Flow**:
   - Log out from `Profile` $\rightarrow$ Log in as `alice@lafina.ph` / `Password123!`.
   - On `Today` screen, view assigned shifts and tasks.
   - Update task status to `Submit for Review`.
   - Switch back to `manager@lafina.ph` $\rightarrow$ Open `Work` tab $\rightarrow$ Filter by `Pending Review` $\rightarrow$ Review submission with approval or reopen with feedback.

---

# LAFINA Backend (FastAPI & PostgreSQL)

LAFINA includes an offline-first FastAPI backend providing cloud account authentication, PostgreSQL synchronization, and DeepSeek-V4 Flash online assistant proxying.

## Backend Prerequisites
- Python 3.12+
- PostgreSQL database (optional for local testing; SQLite in-memory fallback is used during pytest)

## 1. Install Backend Dependencies
From the repository root:
```sh
pip install -r backend/requirements.txt
```

## 2. Environment Variables & Production Deployment
Create a `.env` file in the root directory (or inside `backend/`):
```env
ENVIRONMENT=development
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/lafina
JWT_ISSUER=lafina-auth
JWT_AUDIENCE=lafina-app
DEEPSEEK_API_KEY=sk-your-deepseek-api-key
```
*(Note: If RS256 RSA keys are omitted in development, temporary keys are generated automatically on startup).*

### DeepSeek API Key Production Setup (Render)
1. **Generate Key**: Create an API key through the official [DeepSeek Platform](https://platform.deepseek.com/).
2. **Configure Environment Secret**: In your Render dashboard, navigate to Environment Variables and add `DEEPSEEK_API_KEY` as a secret environment variable.
3. **Set Production Mode**: Set `ENVIRONMENT=production`. When `ENVIRONMENT=production`, backend startup will fail fast if `DEEPSEEK_API_KEY` is missing or set to a placeholder value.
4. **Client Security Standard**: **NEVER** place the DeepSeek API key in React Native client configuration, source control, screenshots, logs, or client requests. The mobile app communicates strictly with the FastAPI `/v1/ai/chat` endpoint and never sees or receives provider credentials.
5. **Key Rotation Procedure**:
   - Create a new key on the DeepSeek Platform.
   - Update the `DEEPSEEK_API_KEY` secret environment variable in Render.
   - Redeploy the web service successfully.
   - Revoke the previous key on the DeepSeek Platform.


### Flashcards: PDF Reading (Render)
Flashcard generation reads the uploaded PDF on the server, so `pdfplumber` must
be installed there. It is listed in `backend/requirements.txt`, so a Render
deploy that runs `pip install -r backend/requirements.txt` picks it up; if
`/v1/ai/flashcards` answers *"PDF reading is not installed on the server"*, the
service is running a build from before that line was added and needs a redeploy.

Scanned PDFs additionally need text recognition, which is **optional**:

```sh
pip install pytesseract pillow      # the Python wrapper
```

The wrapper drives the Tesseract program, which is a system package rather than
a Python one. Render's native Python runtime cannot install it, so OCR needs a
Docker deploy whose image runs `apt-get install -y tesseract-ocr`. Without it
everything else still works: pages with selectable text are read normally, and a
scanned PDF is refused with an explanation instead of producing an empty deck.

## 3. Creating Admin Accounts (No Hardcoded Credentials)
To create an admin account or promote an existing account without hardcoding passwords:

**Option A: Using the Secure Admin CLI (Interactive Prompt)**
```sh
python -m backend.scripts.create_admin
```
*(Prompts interactively for `admin email` and `password` without storing or echoing them).*

**Option B: Via Environment Variables in `.env`**
```env
ADMIN_EMAIL=youradmin@domain.com
ADMIN_PASSWORD=your-secure-min-15-char-password
```

## 4. Database Migrations (PostgreSQL)
Run Alembic migrations to apply PostgreSQL table schemas and Row-Level Security (RLS) policies:
```sh
python -m alembic -c backend/alembic.ini upgrade head
```

## 5. Run Development Server
Start FastAPI server with auto-reload:
```sh
python -m uvicorn backend.app.main:app --reload --port 8000
```
- **OpenAPI Interactive Docs**: [http://localhost:8000/docs](http://localhost:8000/docs)
- **SQLAdmin Studio (Secure Admin UI)**: [http://localhost:8000/admin](http://localhost:8000/admin) (Requires logging in with an active account having `role == "admin"`).

## 6. Run Backend Tests & Linting
Run the Pytest suite (covers Auth, RS256 JWT, Argon2id, Sync LWW ordering, and DeepSeek proxy):
```sh
python -m pytest backend/tests
```

Run Ruff linter check:
```sh
python -m ruff check backend
```
