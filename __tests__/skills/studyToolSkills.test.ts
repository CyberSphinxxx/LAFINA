import { cloudClient } from '../../src/cloud/cloudClient';
import {
  base64ByteLength,
  base64Prefix,
  flashcardSkill,
  MAX_PDF_BYTES,
} from '../../src/skills/flashcardSkill';
import { studyNotesSkill } from '../../src/skills/studyNotesSkill';

const encode = (text: string): string => Buffer.from(text, 'binary').toString('base64');

describe('study tool uploads from React Native', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('measures and peeks into base64 without decoding it all', () => {
    for (const text of ['', 'a', 'ab', 'abc', 'abcd', '%PDF-1.7 body']) {
      expect(base64ByteLength(encode(text))).toBe(text.length);
    }
    expect(Array.from(base64Prefix(encode('%PDF-1.7'), 5))).toEqual([0x25, 0x50, 0x44, 0x46, 0x2d]);
  });

  it('sends a base64 PDF as it is', async () => {
    const base64 = encode('%PDF-1.7 lecture');
    const request = jest.spyOn(cloudClient, 'request').mockResolvedValue({
      status: 'success',
      data: { deckTitle: 'Lecture', cards: [] } as never,
    });

    const result = await flashcardSkill.generateFromPdf({ filename: 'lecture.pdf', base64, maxCards: 500 });

    expect(result.status).toBe('success');
    const [path, init] = request.mock.calls[0];
    expect(path).toBe('/v1/ai/flashcards');
    expect(JSON.parse(String(init?.body))).toEqual({
      filename: 'lecture.pdf',
      contentBase64: base64,
      maxCards: 120,
    });
  });

  it('refuses what the server would refuse, before uploading', async () => {
    const request = jest.spyOn(cloudClient, 'request');
    const notPdf = await flashcardSkill.generateFromPdf({ filename: 'a.pdf', base64: encode('hello world') });
    expect(notPdf).toEqual({ status: 'validation_error', error: 'That file is not a PDF.' });
    const empty = await flashcardSkill.generateFromPdf({ filename: 'a.pdf', base64: '' });
    expect(empty.error).toBe('That file is empty.');
    // Six bytes encode to exactly eight characters, so more can be appended.
    const huge = await flashcardSkill.generateFromPdf({
      filename: 'a.pdf',
      base64: encode('%PDF-1') + 'A'.repeat(Math.ceil((MAX_PDF_BYTES * 4) / 3)),
    });
    expect(huge.error).toMatch(/larger than 15 MB/);
    const malformed = await flashcardSkill.generateFromPdf({ filename: 'a.pdf', base64: '=====!!!' });
    expect(malformed.error).toBe('That file is not a PDF.');
    expect(request).not.toHaveBeenCalled();
  });

  it('accepts Word and PowerPoint files for study notes by signature and extension', async () => {
    const request = jest.spyOn(cloudClient, 'request').mockResolvedValue({ status: 'success', data: {} as never });
    const zip = encode('PK package');

    expect((await studyNotesSkill.summarizeDocument({ filename: 'slides.pptx', base64: zip })).status).toBe('success');
    expect((await studyNotesSkill.summarizeDocument({ filename: 'archive.zip', base64: zip })).status).toBe(
      'validation_error'
    );
    expect(request).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(request.mock.calls[0][1]?.body)).contentBase64).toBe(zip);
  });
});
