import { calendarVisibilityStore } from '../../src/storage/calendarVisibilityStore';
import RNFS from 'react-native-fs';

describe('calendarVisibilityStore account isolation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns a visible main calendar when no file exists', async () => {
    (RNFS.exists as jest.Mock).mockResolvedValueOnce(false);

    await expect(calendarVisibilityStore.getVisibilityMap('user-a'))
      .resolves.toEqual({ main: true });
  });

  it('returns only the requested user visibility map', async () => {
    (RNFS.exists as jest.Mock).mockResolvedValueOnce(true);
    (RNFS.readFile as jest.Mock).mockResolvedValueOnce(JSON.stringify({
      version: 2,
      users: [
        { userId: 'user-a', visibility: { main: false, 'batch-a': true } },
        { userId: 'user-b', visibility: { main: true, 'batch-b': false } },
      ],
    }));

    await expect(calendarVisibilityStore.getVisibilityMap('user-a'))
      .resolves.toEqual({ main: false, 'batch-a': true });
  });

  it('quarantines a legacy unscoped map instead of assigning it to either user', async () => {
    const legacy = { main: false, 'legacy-batch': false };
    (RNFS.exists as jest.Mock)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);
    (RNFS.readFile as jest.Mock)
      .mockResolvedValueOnce(JSON.stringify(legacy))
      .mockResolvedValueOnce(JSON.stringify(legacy));

    await expect(calendarVisibilityStore.getVisibilityMap('user-a'))
      .resolves.toEqual({ main: true });
    await expect(calendarVisibilityStore.getVisibilityMap('user-b'))
      .resolves.toEqual({ main: true });
  });

  it('preserves quarantined legacy data when writing the first scoped account map', async () => {
    const legacy = { main: false, 'legacy-batch': false };
    (RNFS.exists as jest.Mock).mockResolvedValueOnce(true);
    (RNFS.readFile as jest.Mock).mockResolvedValueOnce(JSON.stringify(legacy));
    (RNFS.writeFile as jest.Mock).mockResolvedValueOnce(undefined);

    await calendarVisibilityStore.setVisibility('user-a', 'batch-a', false);

    const written = JSON.parse((RNFS.writeFile as jest.Mock).mock.calls[0][1]);
    expect(written).toEqual({
      version: 2,
      users: [{ userId: 'user-a', visibility: { main: true, 'batch-a': false } }],
      legacyUnscoped: legacy,
    });
  });

  it('updates one user without modifying another user map', async () => {
    const stored = {
      version: 2,
      users: [
        { userId: 'user-a', visibility: { main: true } },
        { userId: 'user-b', visibility: { main: false, 'batch-b': true } },
      ],
    };
    (RNFS.exists as jest.Mock).mockResolvedValueOnce(true);
    (RNFS.readFile as jest.Mock).mockResolvedValueOnce(JSON.stringify(stored));
    (RNFS.writeFile as jest.Mock).mockResolvedValueOnce(undefined);

    await calendarVisibilityStore.setVisibility('user-a', 'batch-a', false);

    const written = JSON.parse((RNFS.writeFile as jest.Mock).mock.calls[0][1]);
    expect(written.users).toEqual([
      { userId: 'user-a', visibility: { main: true, 'batch-a': false } },
      { userId: 'user-b', visibility: { main: false, 'batch-b': true } },
    ]);
  });
});
