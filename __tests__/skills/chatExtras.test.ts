import { detectDocumentRequest } from '../../src/ai/documentIntent';
import { cloudClient } from '../../src/cloud/cloudClient';
import {
  documentSkill,
  MAX_DOCUMENT_CHARS,
  MAX_DOCUMENT_MESSAGES,
  trimDocumentHistory,
} from '../../src/skills/documentSkill';
import { handbookPreference, handbookSourceLabel, onlineChatSkill } from '../../src/skills/onlineChatSkill';
import { initDatabase } from '../../src/storage/dbInit';
import type { ChatMessagePayload } from '../../src/skills/onlineChatSkill';

describe('chat extras shared with the desktop app', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('notices a request for a file in so many words, and leaves scheduling alone', () => {
    const asks: Array<[string, string]> = [
      ['Make me a PDF study guide for the chat above', 'pdf'],
      ['put this budget in an Excel sheet', 'xlsx'],
      ['Create a PowerPoint about photosynthesis', 'pptx'],
      ['turn the study plan above into a word document', 'docx'],
      ['Generate slides on the French Revolution', 'pptx'],
      ['export our conversation as a docx', 'docx'],
      ['I need a spreadsheet for my grocery budget', 'xlsx'],
      ['can you make a presentation on cells?', 'pptx'],
    ];
    for (const [text, format] of asks) {
      expect([text, detectDocumentRequest(text)]).toEqual([text, format]);
    }

    const notFiles = [
      'remind me to submit the PDF Friday at 5 pm',
      'schedule a meeting to review the slides tomorrow at 3pm',
      'block 2 to 4 pm for my powerpoint',
      'create a task to finish the excel report',
      'make flashcards from the pdf',
      'make a deck of flashcards on mitosis',
      'what is a pdf?',
      'help me prepare for my presentation',
      'summarize the document I sent',
      'I want to read the pdf again',
      '',
    ];
    for (const text of notFiles) {
      expect([text, detectDocumentRequest(text)]).toEqual([text, null]);
    }
  });

  it('keeps the newest turns that fit the chat allowance, and always the request', () => {
    const long = 'x'.repeat(3000);
    const conversation: ChatMessagePayload[] = [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: long },
      { role: 'user', content: long },
      { role: 'assistant', content: long },
      { role: 'user', content: 'Make that into a PDF' },
    ];
    const trimmed = trimDocumentHistory(conversation);
    expect(trimmed.reduce((sum, message) => sum + message.content.length, 0)).toBeLessThanOrEqual(MAX_DOCUMENT_CHARS);
    expect(trimmed[trimmed.length - 1].content).toBe('Make that into a PDF');
    expect(trimmed[0].role).toBe('user');

    const many = Array.from({ length: 25 }, (_, index): ChatMessagePayload => ({
      role: index % 2 ? 'assistant' : 'user',
      content: `turn ${index}`,
    }));
    expect(trimDocumentHistory(many).length).toBeLessThanOrEqual(MAX_DOCUMENT_MESSAGES);
    expect(trimDocumentHistory([{ role: 'user', content: 'y'.repeat(20000) }])[0].content.length).toBeLessThanOrEqual(
      MAX_DOCUMENT_CHARS,
    );
  });

  it('asks for a file only when the conversation ends with a request', async () => {
    const request = jest.spyOn(cloudClient, 'request').mockResolvedValue({ status: 'success', data: {} as never });
    const refused = await documentSkill.generate({
      format: 'pdf',
      messages: [{ role: 'assistant', content: 'Hello' }],
    });
    expect(refused.status).toBe('validation_error');
    expect(request).not.toHaveBeenCalled();

    await documentSkill.generate({ format: 'xlsx', messages: [{ role: 'user', content: 'A budget sheet' }] });
    expect(request).toHaveBeenCalledWith('/v1/ai/documents', expect.anything(), true);
    expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toEqual({
      format: 'xlsx',
      messages: [{ role: 'user', content: 'A budget sheet' }],
    });
  });

  it('labels the handbook pages a reply drew on', () => {
    const source = (page: string, pageEnd = page) => ({ page, pageEnd, section: 'Chapter 8', score: 0.5 });
    expect(handbookSourceLabel([source('32')])).toBe('Handbook p. 32');
    expect(handbookSourceLabel([source('88', '89'), source('32'), source('88', '89')])).toBe('Handbook pp. 88–89, 32');
    expect(handbookSourceLabel([])).toBeNull();
    expect(handbookSourceLabel(undefined)).toBeNull();
  });

  it('sends the handbook switch with each question, and keeps it per account on this device', async () => {
    await initDatabase();
    expect(handbookPreference.read('handbook-a')).toBe(true);
    handbookPreference.write('handbook-a', false);
    expect(handbookPreference.read('handbook-a')).toBe(false);
    expect(handbookPreference.read('handbook-b')).toBe(true);

    const request = jest.spyOn(cloudClient, 'request').mockResolvedValue({ status: 'success', data: {} as never });
    await onlineChatSkill.sendChatMessage([{ role: 'user', content: 'Grading system?' }], { useHandbook: false });
    expect(JSON.parse(String(request.mock.calls[0][1]?.body)).useHandbook).toBe(false);
    await onlineChatSkill.sendChatMessage([{ role: 'user', content: 'Dress code?' }]);
    expect(JSON.parse(String(request.mock.calls[1][1]?.body)).useHandbook).toBe(true);
  });
});
