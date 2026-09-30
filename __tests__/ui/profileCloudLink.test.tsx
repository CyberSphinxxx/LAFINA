import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { db } from '../../src/storage/database';
import { initDatabase } from '../../src/storage/dbInit';
import { ThemeProvider } from '../../src/ui/contexts/ThemeContext';
import { ProfileScreen } from '../../src/ui/screens/ProfileScreen';

describe('profile cloud linking', () => {
  beforeAll(async () => {
    await initDatabase();
  });

  beforeEach(() => {
    db.executeSync('DELETE FROM users');
    const now = new Date().toISOString();
    db.executeSync(
      `INSERT INTO users (
         id, username, email, role, is_new_user, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 0, ?, ?)`,
      ['profile-user', 'Profile User', 'profile@example.com', 'student', now, now],
    );
  });

  it('does not expose a manual FastAPI link action or second password prompt', async () => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <ThemeProvider userId="profile-user">
          <ProfileScreen
            userId="profile-user"
            refreshTrigger={0}
            onRefresh={jest.fn()}
          />
        </ThemeProvider>,
      );
    });

    const rendered = JSON.stringify(renderer.toJSON());
    expect(rendered).not.toContain('Create or Link FastAPI');
    expect(rendered).not.toContain('FastAPI cloud password');

    await ReactTestRenderer.act(async () => renderer.unmount());
  });
});
