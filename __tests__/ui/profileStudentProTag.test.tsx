import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { db } from '../../src/storage/database';
import { initDatabase } from '../../src/storage/dbInit';
import { businessStore } from '../../src/storage/businessStore';
import { ThemeProvider } from '../../src/ui/contexts/ThemeContext';
import { ProfileScreen } from '../../src/ui/screens/ProfileScreen';

const USER = 'pro-tag-user';

const renderProfile = async (): Promise<ReactTestRenderer.ReactTestRenderer> => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <ThemeProvider userId={USER}>
        <ProfileScreen userId={USER} refreshTrigger={0} onRefresh={jest.fn()} />
      </ThemeProvider>,
    );
  });
  return renderer;
};

const hasTag = (renderer: ReactTestRenderer.ReactTestRenderer): boolean =>
  renderer.root.findAll((node) => node.props.testID === 'student-pro-tag').length > 0;

describe('Student Pro tag on the profile', () => {
  beforeAll(async () => {
    await initDatabase();
  });

  const createUser = (role: string): void => {
    db.executeSync('DELETE FROM users');
    db.executeSync('DELETE FROM business_capabilities_cache');
    const now = new Date().toISOString();
    db.executeSync(
      `INSERT INTO users (id, username, email, role, is_new_user, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
      [USER, 'Pro Tag User', 'pro@ustp.edu.ph', role, now, now],
    );
  };

  it('shows the tag for a Student Pro account', async () => {
    createUser('student_pro');
    const renderer = await renderProfile();
    expect(hasTag(renderer)).toBe(true);
    await ReactTestRenderer.act(async () => renderer.unmount());
  });

  it('shows the tag when the cached plan is Student Pro before the role catches up', async () => {
    createUser('student');
    businessStore.saveCachedCapabilities(USER, 'student_pro', 'student_pro', null);
    const renderer = await renderProfile();
    expect(hasTag(renderer)).toBe(true);
    await ReactTestRenderer.act(async () => renderer.unmount());
  });

  it.each(['student', 'business', 'admin'])('does not show the tag for a %s account', async (role) => {
    createUser(role);
    const renderer = await renderProfile();
    expect(hasTag(renderer)).toBe(false);
    await ReactTestRenderer.act(async () => renderer.unmount());
  });
});
