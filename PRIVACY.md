# Privacy Policy: Agenda to Calendar (Chrome extension)

_Last updated: 1 October 2026_

Agenda to Calendar is an open-source browser extension that adds "Add to Google Calendar" and ".ics" buttons to sessions on supported conference agenda pages (currently TOKEN2049 Singapore 2026). This policy explains what the extension does and does not do with your data.

## Summary

**The extension does not collect, store, sell or share any personal data.** There is no account, no analytics, no tracking, no cookies and no server operated by us.

## What the extension accesses

- **Agenda pages only.** The extension runs only on the agenda URLs listed in its manifest (for example `https://token2049.com/singapore/agenda`). It does not run on any other website.
- **Public session details.** On those pages it reads the session information already displayed (title, date, time, stage, speakers, venue) so it can build calendar entries.
- **Same-site requests.** When you click "Download all sessions (.ics)", the extension requests the other pages of the same public agenda from the same website, to include every session. No other network requests are made.

## What happens when you use the buttons

- **Add to Google Calendar** opens a Google Calendar page in a new tab with the session details pre-filled. Nothing is saved unless you choose to save the event in Google Calendar. Your use of Google Calendar is governed by [Google's Privacy Policy](https://policies.google.com/privacy).
- **.ics / Download all** creates a calendar file in your browser and downloads it to your device. The file is generated locally and is not sent anywhere.

## What the extension does not do

- It does not collect personally identifiable information, health, financial, authentication, communications, location or web history data.
- It does not read or modify pages other than the supported agenda pages.
- It does not use `chrome.storage`, cookies or any other persistent storage.
- It does not load or execute remote code; all code is included in the extension package.
- It does not sell or transfer data to third parties, use data for purposes unrelated to its single purpose, or use data to determine creditworthiness or for lending.

## Permissions

The extension requests no special Chrome permissions. Its only access is the content script that runs on the supported agenda pages, used as described above.

## Open source

All source code is public, so you can verify this policy yourself or build the extension from source:
https://github.com/DeveloperAlly/token2049-agenda

The repository also contains separate tooling (a sync job that publishes the public agenda to a spreadsheet and calendar feed). That tooling is not part of the extension and does not run in your browser.

## Changes

If this policy changes, the updated version will be published in this file with a new "Last updated" date. The full change history is available in the repository's commit history.

## Contact

Questions or concerns: open an issue at https://github.com/DeveloperAlly/token2049-agenda/issues

_This extension is an independent project and is not affiliated with or endorsed by TOKEN2049._
