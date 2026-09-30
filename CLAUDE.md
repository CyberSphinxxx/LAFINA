# LAFINA — AI-Powered Offline Scheduling Assistant

## Project Overview

LAFINA is an Android-only React Native app for students at USTP (University of Science and Technology of Southern Philippines). It provides offline-first scheduling, notes, task management, and voice interaction using on-device AI models.

## Tech Stack

- **Framework:** React Native 0.86.0 (Android-only)
- **Language:** TypeScript (strict mode)
- **Database:** @op-engineering/op-sqlite (local SQLite)
- **AI Voice:** Whisper.cpp (on-device STT), SmolLM2 (on-device NLU)
- **Icons:** lucide-react-native
- **State:** React Context + local stores backed by SQLite

## Core Architecture Rules

### Offline-First (Strict)
- All data lives in local SQLite. No cloud backend.
- Voice processing is entirely on-device (no audio uploaded).
- AI/storage layers must NOT import from UI/cloud layers.
- UI components must NOT import directly from AI or storage internals — use barrel exports.

### Dependency Flow
```
src/storage/  (SQLite stores, pure data access)
src/utils/    (pure utility functions, no UI imports)
src/ai/       (voice/NLU pipeline, no UI imports)
  └── src/storage/  (AI reads/writes storage)
  └── src/utils/    (AI uses utils)
src/skills/   (server AI calls: flashcards, study notes, meeting notes; no UI imports)
  └── src/cloud/    (skills call the LAFINA API through cloudClient)
src/meetings/ (meeting pipeline: transcript cleanup, notes, error catalogue; no UI imports)
  └── src/skills/   (notes are written through meetingNotesSkill)
src/updates/  (in-app updates: signed GitHub release check, download, restart; no UI imports)
src/ui/       (React components, screens)
  └── src/storage/  (UI imports barrel from storage)
  └── src/utils/    (UI imports barrel from utils)
  └── src/ai/       (UI imports barrel from ai)
  └── src/updates/  (UI imports barrel from updates)
```

In-app updates replace the JS bundle only; see `docs/in-app-updates.md` for when a new APK is still required.

## Testing & Quality

```bash
npm run typecheck       # TypeScript checking
npm run lint            # ESLint
npm test                # Jest unit tests
npm run preflight       # All three (typecheck + test + lint)
npm run test:coverage   # Jest with coverage
npm run android         # Build & run on device/emulator
```

## Project Conventions

- **Branch naming:** `prefix/short-description` (e.g., `feat/auth-onboarding`, `fix/calendar-notes`)
- **Prefixes:** `feat/`, `fix/`, `chore/`, `refactor/`, `docs/`
- All components use `StyleSheet.create` for static styles and `useThemedStyles` for theme-dependent styles.
- Hardcoded hex colors are forbidden — always use `colors.xxx` from `useTheme()`.
