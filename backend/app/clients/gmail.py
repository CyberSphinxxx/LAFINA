import base64
from email.message import EmailMessage
from html.parser import HTMLParser
import re
from typing import Any, Optional
import httpx
from backend.app.config import Settings, get_settings


class HTMLTextExtractor(HTMLParser):
    """
    Safe, zero-dependency HTML text extractor that converts HTML to plain text
    while stripping scripts, styles, and unwanted tags, and preserving newlines.
    """
    def __init__(self):
        super().__init__()
        self._pieces: list[str] = []
        self._ignore: bool = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]):
        tag_lower = tag.lower()
        if tag_lower in ("script", "style", "head", "title", "meta"):
            self._ignore = True
        elif tag_lower in ("br", "p", "div", "tr", "li", "h1", "h2", "h3", "h4", "h5", "h6"):
            self._pieces.append("\n")

    def handle_endtag(self, tag: str):
        tag_lower = tag.lower()
        if tag_lower in ("script", "style", "head", "title", "meta"):
            self._ignore = False
        elif tag_lower in ("p", "div", "tr", "li"):
            self._pieces.append("\n")

    def handle_data(self, data: str):
        if not self._ignore and data:
            self._pieces.append(data)

    def get_text(self) -> str:
        raw_text = "".join(self._pieces)
        # Collapse multiple blank lines into max 2 newlines
        cleaned = re.sub(r"\n\s*\n+", "\n\n", raw_text)
        return cleaned.strip()


def html_to_safe_text(html_content: str) -> str:
    """
    Converts HTML content to clean, readable plain text.
    """
    if not html_content:
        return ""
    try:
        extractor = HTMLTextExtractor()
        extractor.feed(html_content)
        return extractor.get_text()
    except Exception:
        # Fallback strip tags via regex
        clean = re.sub(r"<[^>]+>", " ", html_content)
        return re.sub(r"\s+", " ", clean).strip()


def base64url_decode(encoded_str: str) -> bytes:
    """Decodes standard base64url encoded string from Gmail API."""
    if not encoded_str:
        return b""
    # Fix padding
    rem = len(encoded_str) % 4
    if rem > 0:
        encoded_str += "=" * (4 - rem)
    return base64.urlsafe_b64decode(encoded_str.encode("utf-8"))


def base64url_encode(data: bytes) -> str:
    """Encodes bytes to base64url string without trailing padding."""
    return base64.urlsafe_b64encode(data).decode("utf-8").rstrip("=")


class GmailClient:
    """
    Async HTTP Client for Google OAuth2 and Gmail REST API operations.
    """
    def __init__(self, settings: Optional[Settings] = None):
        self.settings = settings or get_settings()
        self._client: Optional[httpx.AsyncClient] = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=30.0)
        return self._client

    async def close(self):
        if self._client and not self._client.is_closed:
            await self._client.aclose()

    def get_client_id(self) -> str:
        return self.settings.GOOGLE_CLIENT_ID or "mock-client-id"

    def get_client_secret(self) -> str:
        if self.settings.GOOGLE_CLIENT_SECRET:
            return self.settings.GOOGLE_CLIENT_SECRET.get_secret_value().strip()
        return "mock-client-secret"

    async def exchange_code_for_tokens(
        self, code: str, code_verifier: str, redirect_uri: str
    ) -> dict[str, Any]:
        """
        Exchanges authorization code and PKCE code_verifier for Google tokens.
        """
        client = await self._get_client()
        data = {
            "code": code,
            "client_id": self.get_client_id(),
            "client_secret": self.get_client_secret(),
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
            "code_verifier": code_verifier,
        }
        res = await client.post("https://oauth2.googleapis.com/token", data=data)
        if res.status_code != 200:
            raise ValueError(f"Google token exchange failed ({res.status_code}): {res.text}")
        return res.json()

    async def refresh_access_token(self, refresh_token: str) -> dict[str, Any]:
        """
        Refreshes access token using refresh_token.
        """
        client = await self._get_client()
        data = {
            "client_id": self.get_client_id(),
            "client_secret": self.get_client_secret(),
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        }
        res = await client.post("https://oauth2.googleapis.com/token", data=data)
        if res.status_code != 200:
            raise ValueError(f"Google token refresh failed ({res.status_code}): {res.text}")
        return res.json()

    async def revoke_token(self, token: str) -> bool:
        """
        Revokes an OAuth access or refresh token with Google.
        """
        try:
            client = await self._get_client()
            res = await client.post(
                "https://oauth2.googleapis.com/revoke",
                params={"token": token},
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            return res.status_code == 200
        except Exception:
            return False

    async def get_user_profile(self, access_token: str) -> dict[str, Any]:
        """
        Retrieves user's Gmail profile (emailAddress, messagesTotal, threadsTotal).
        """
        client = await self._get_client()
        headers = {"Authorization": f"Bearer {access_token}"}
        res = await client.get(
            "https://gmail.googleapis.com/gmail/v1/users/me/profile", headers=headers
        )
        if res.status_code != 200:
            raise ValueError(f"Failed to fetch Gmail profile ({res.status_code}): {res.text}")
        return res.json()

    async def list_threads(
        self,
        access_token: str,
        q: Optional[str] = None,
        page_token: Optional[str] = None,
        max_results: int = 50,
    ) -> dict[str, Any]:
        """
        Lists Gmail threads matching query, up to max_results (max 50).
        """
        client = await self._get_client()
        headers = {"Authorization": f"Bearer {access_token}"}
        params: dict[str, Any] = {"maxResults": min(max_results, 50)}
        if q:
            params["q"] = q
        if page_token:
            params["pageToken"] = page_token

        res = await client.get(
            "https://gmail.googleapis.com/gmail/v1/users/me/threads",
            headers=headers,
            params=params,
        )
        if res.status_code != 200:
            raise ValueError(f"Failed to list Gmail threads ({res.status_code}): {res.text}")
        data = res.json()

        threads_raw = data.get("threads", [])
        next_page_token = data.get("nextPageToken")
        result_size_estimate = data.get("resultSizeEstimate", len(threads_raw))

        # Summaries list
        thread_summaries = []
        for item in threads_raw:
            thread_id = item.get("id")
            snippet = item.get("snippet", "")
            history_id = item.get("historyId", "")
            thread_summaries.append({
                "thread_id": thread_id,
                "history_id": history_id,
                "snippet": snippet,
            })

        return {
            "threads": thread_summaries,
            "next_page_token": next_page_token,
            "result_size_estimate": result_size_estimate,
        }

    def _parse_message_part(self, part: dict[str, Any], plain_parts: list[str], html_parts: list[str], attachments: list[dict[str, Any]]):
        """Recursively parses MIME parts for text bodies and attachment metadata."""
        mime_type = part.get("mimeType", "").lower()
        filename = part.get("filename", "")
        body = part.get("body", {})
        attachment_id = body.get("attachmentId")
        size = body.get("size", 0)

        if filename or attachment_id:
            attachments.append({
                "id": attachment_id or "",
                "filename": filename or "attachment",
                "mime_type": mime_type,
                "size": size,
            })

        if mime_type == "text/plain" and not filename:
            data = body.get("data")
            if data:
                try:
                    plain_parts.append(base64url_decode(data).decode("utf-8", errors="replace"))
                except Exception:
                    pass
        elif mime_type == "text/html" and not filename:
            data = body.get("data")
            if data:
                try:
                    html_parts.append(base64url_decode(data).decode("utf-8", errors="replace"))
                except Exception:
                    pass

        for subpart in part.get("parts", []):
            self._parse_message_part(subpart, plain_parts, html_parts, attachments)

    def parse_message_payload(self, message_raw: dict[str, Any]) -> dict[str, Any]:
        """
        Parses raw Gmail message resource into clean structure.
        """
        msg_id = message_raw.get("id", "")
        thread_id = message_raw.get("threadId", "")
        label_ids = message_raw.get("labelIds", [])
        snippet = message_raw.get("snippet", "")
        internal_date = message_raw.get("internalDate", "")

        payload = message_raw.get("payload", {})
        headers_list = payload.get("headers", [])
        headers = {h.get("name", "").lower(): h.get("value", "") for h in headers_list}

        subject = headers.get("subject", "(No Subject)")
        from_address = headers.get("from", "")
        to_address = headers.get("to", "")
        cc_address = headers.get("cc", "")
        bcc_address = headers.get("bcc", "")
        date_str = headers.get("date", "")

        plain_parts: list[str] = []
        html_parts: list[str] = []
        attachments: list[dict[str, Any]] = []

        self._parse_message_part(payload, plain_parts, html_parts, attachments)

        body_plain = "\n".join(plain_parts).strip()
        body_html = "\n".join(html_parts).strip()

        if not body_plain and body_html:
            body_plain = html_to_safe_text(body_html)

        is_unread = "UNREAD" in label_ids

        return {
            "message_id": msg_id,
            "thread_id": thread_id,
            "subject": subject,
            "from_address": from_address,
            "to_address": to_address,
            "cc_address": cc_address,
            "bcc_address": bcc_address,
            "date": date_str,
            "internal_date": internal_date,
            "snippet": snippet,
            "body_plain": body_plain,
            "body_html": body_html,
            "is_unread": is_unread,
            "attachments": attachments,
            "label_ids": label_ids,
        }

    async def get_thread_detail(self, access_token: str, thread_id: str) -> dict[str, Any]:
        """
        Fetches full thread messages and parses them into structured objects.
        """
        client = await self._get_client()
        headers = {"Authorization": f"Bearer {access_token}"}
        res = await client.get(
            f"https://gmail.googleapis.com/gmail/v1/users/me/threads/{thread_id}",
            headers=headers,
            params={"format": "full"},
        )
        if res.status_code != 200:
            raise ValueError(f"Failed to fetch Gmail thread ({res.status_code}): {res.text}")
        data = res.json()

        raw_messages = data.get("messages", [])
        parsed_messages = [self.parse_message_payload(msg) for msg in raw_messages]

        # Extract top-level thread metadata from newest/first message
        subject = parsed_messages[0]["subject"] if parsed_messages else "(No Subject)"
        has_attachments = any(len(m["attachments"]) > 0 for m in parsed_messages)
        is_unread = any(m["is_unread"] for m in parsed_messages)

        return {
            "thread_id": thread_id,
            "history_id": data.get("historyId", ""),
            "subject": subject,
            "messages": parsed_messages,
            "has_attachments": has_attachments,
            "is_unread": is_unread,
            "message_count": len(parsed_messages),
        }

    def _build_rfc2822_message(
        self,
        from_address: str,
        to_address: str,
        subject: str,
        body: str,
        cc: Optional[str] = None,
        bcc: Optional[str] = None,
        thread_id: Optional[str] = None,
    ) -> bytes:
        """
        Builds RFC 2822 MIME message bytes.
        """
        msg = EmailMessage()
        msg["From"] = from_address
        msg["To"] = to_address
        msg["Subject"] = subject
        if cc:
            msg["Cc"] = cc
        if bcc:
            msg["Bcc"] = bcc
        msg.set_content(body)
        return msg.as_bytes()

    async def create_draft(
        self,
        access_token: str,
        from_address: str,
        to_address: str,
        subject: str,
        body: str,
        cc: Optional[str] = None,
        bcc: Optional[str] = None,
        thread_id: Optional[str] = None,
    ) -> dict[str, Any]:
        """
        Creates a new draft message in user's Gmail account.
        """
        client = await self._get_client()
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        }
        msg_bytes = self._build_rfc2822_message(
            from_address=from_address,
            to_address=to_address,
            subject=subject,
            body=body,
            cc=cc,
            bcc=bcc,
            thread_id=thread_id,
        )
        encoded_raw = base64url_encode(msg_bytes)

        message_payload: dict[str, Any] = {"raw": encoded_raw}
        if thread_id:
            message_payload["threadId"] = thread_id

        res = await client.post(
            "https://gmail.googleapis.com/gmail/v1/users/me/drafts",
            headers=headers,
            json={"message": message_payload},
        )
        if res.status_code != 200:
            raise ValueError(f"Failed to create Gmail draft ({res.status_code}): {res.text}")
        data = res.json()
        return {
            "draft_id": data.get("id"),
            "message_id": data.get("message", {}).get("id"),
            "thread_id": data.get("message", {}).get("threadId"),
        }

    async def update_draft(
        self,
        access_token: str,
        draft_id: str,
        from_address: str,
        to_address: str,
        subject: str,
        body: str,
        cc: Optional[str] = None,
        bcc: Optional[str] = None,
        thread_id: Optional[str] = None,
    ) -> dict[str, Any]:
        """
        Updates an existing draft in user's Gmail account.
        """
        client = await self._get_client()
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        }
        msg_bytes = self._build_rfc2822_message(
            from_address=from_address,
            to_address=to_address,
            subject=subject,
            body=body,
            cc=cc,
            bcc=bcc,
            thread_id=thread_id,
        )
        encoded_raw = base64url_encode(msg_bytes)

        message_payload: dict[str, Any] = {"raw": encoded_raw}
        if thread_id:
            message_payload["threadId"] = thread_id

        res = await client.put(
            f"https://gmail.googleapis.com/gmail/v1/users/me/drafts/{draft_id}",
            headers=headers,
            json={"id": draft_id, "message": message_payload},
        )
        if res.status_code != 200:
            raise ValueError(f"Failed to update Gmail draft ({res.status_code}): {res.text}")
        data = res.json()
        return {
            "draft_id": data.get("id"),
            "message_id": data.get("message", {}).get("id"),
            "thread_id": data.get("message", {}).get("threadId"),
        }

    async def send_draft(self, access_token: str, draft_id: str) -> dict[str, Any]:
        """
        Sends an existing draft via Gmail API.
        """
        client = await self._get_client()
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        }
        res = await client.post(
            "https://gmail.googleapis.com/gmail/v1/users/me/drafts/send",
            headers=headers,
            json={"id": draft_id},
        )
        if res.status_code != 200:
            raise ValueError(f"Failed to send Gmail draft ({res.status_code}): {res.text}")
        data = res.json()
        return {
            "message_id": data.get("id"),
            "thread_id": data.get("threadId"),
            "label_ids": data.get("labelIds", []),
        }
