import { importedBatchesStore } from '../../src/storage/importedBatchesStore';
import RNFS from 'react-native-fs';

const ownedBatch = (userId: string, id: string) => ({
  id,
  userId,
  timestamp: '2026-06-24T12:00:00Z',
  fileName: `${userId}.ics`,
  events: [`${userId}-event`],
  blocks: [`${userId}-block`],
  tasks: [`${userId}-task`],
});

describe('importedBatchesStore account isolation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns an empty array when the batch file does not exist', async () => {
    (RNFS.exists as jest.Mock).mockResolvedValueOnce(false);

    await expect(importedBatchesStore.getImportedBatches('user-a')).resolves.toEqual([]);
    expect(RNFS.readFile).not.toHaveBeenCalled();
  });

  it('returns only the requested user and quarantines legacy ownerless batches', async () => {
    const legacy = {
      id: 'legacy-batch',
      timestamp: '2026-06-24T12:00:00Z',
      fileName: 'legacy.ics',
      events: ['legacy-event'],
      blocks: [],
      tasks: [],
    };
    (RNFS.exists as jest.Mock).mockResolvedValueOnce(true);
    (RNFS.readFile as jest.Mock).mockResolvedValueOnce(JSON.stringify([
      ownedBatch('user-a', 'batch-a'),
      ownedBatch('user-b', 'batch-b'),
      legacy,
    ]));

    await expect(importedBatchesStore.getImportedBatches('user-a')).resolves.toEqual([
      ownedBatch('user-a', 'batch-a'),
    ]);
  });

  it('saves under one user without dropping another user or legacy metadata', async () => {
    const legacy = {
      id: 'legacy-batch',
      timestamp: '2026-06-24T12:00:00Z',
      fileName: 'legacy.ics',
      events: [],
      blocks: [],
      tasks: [],
    };
    (RNFS.exists as jest.Mock).mockResolvedValueOnce(true);
    (RNFS.readFile as jest.Mock).mockResolvedValueOnce(JSON.stringify([
      ownedBatch('user-b', 'batch-b'),
      legacy,
    ]));
    (RNFS.writeFile as jest.Mock).mockResolvedValueOnce(undefined);

    await importedBatchesStore.saveImportedBatch(
      'user-a', 'school.ics', ['ev-1'], ['bl-1'], ['tk-1'],
    );

    const written = JSON.parse((RNFS.writeFile as jest.Mock).mock.calls[0][1]);
    expect(written[0]).toMatchObject({
      userId: 'user-a', fileName: 'school.ics',
      events: ['ev-1'], blocks: ['bl-1'], tasks: ['tk-1'],
    });
    expect(written).toEqual(expect.arrayContaining([
      ownedBatch('user-b', 'batch-b'),
      legacy,
    ]));
  });

  it('cannot delete another user batch even when its ID is known', async () => {
    (RNFS.exists as jest.Mock).mockResolvedValueOnce(true);
    (RNFS.readFile as jest.Mock).mockResolvedValueOnce(JSON.stringify([
      ownedBatch('user-a', 'batch-a'),
      ownedBatch('user-b', 'batch-b'),
    ]));

    await expect(importedBatchesStore.deleteImportedBatch('user-a', 'batch-b'))
      .resolves.toBeNull();
    expect(RNFS.writeFile).not.toHaveBeenCalled();
  });

  it('deletes only the matching user batch and preserves all other records', async () => {
    const userA = ownedBatch('user-a', 'batch-a');
    const userB = ownedBatch('user-b', 'batch-b');
    (RNFS.exists as jest.Mock).mockResolvedValueOnce(true);
    (RNFS.readFile as jest.Mock).mockResolvedValueOnce(JSON.stringify([userA, userB]));
    (RNFS.writeFile as jest.Mock).mockResolvedValueOnce(undefined);

    await expect(importedBatchesStore.deleteImportedBatch('user-a', 'batch-a'))
      .resolves.toEqual(userA);
    expect(JSON.parse((RNFS.writeFile as jest.Mock).mock.calls[0][1])).toEqual([userB]);
  });
});
