# Email students: one-time setup

**Email students** sends each student their feedback and correction sheet (PDF) from your school Google account. A web page can't send email by itself, so the grader hands each message to a small Google Apps Script "mailer" that you own. Setup takes about 15 minutes and only has to be done once.

> **Before you start:** this needs your district email to be **Google Workspace** (Gmail), and your district has to allow Apps Script web apps. Step 5 tells you right away if it doesn't.

## 1. Make the mailer

1. In Google Drive (signed in to your **school** account), create a new Google Sheet. Name it something like `Grader mailer`. It will hold the sent log.
2. In the Sheet: **Extensions → Apps Script**.
3. Delete what's in `Code.gs` and paste in everything from [`apps-script/Mailer.gs`](apps-script/Mailer.gs). Click **Save**.

## 2. Make a key and set the properties

1. In the Apps Script editor, choose **makeKey** in the function dropdown and click **Run**. Approve the permissions the first time. The key appears in the **Execution log**; copy it.
2. Open **Project Settings** (gear icon) → **Script Properties** → **Add script property**:

| Property | Value |
|---|---|
| `MAILER_KEY` | the key you just made |
| `ALLOWED_DOMAIN` | `lbschools.net` (only addresses here can get mail, even if the key leaks) |
| `SENDER_NAME` | *optional*: the From name students see |
| `SIGNATURE` | *optional*: added to the end of every email |

The key and your name live here, in your Google account, never in this public repo.

## 3. Deploy it

1. **Deploy → New deployment** → gear → **Web app**.
2. **Execute as:** *Me*. **Who has access:** *Anyone*.
   *Anyone* is needed because the grader page isn't signed in to Google. The key is what keeps it locked, and `ALLOWED_DOMAIN` limits who can receive mail.
3. **Deploy**, approve the permissions (send email as you, edit the Sheet), and copy the **Web app URL**. It ends in `/exec`.

If you edit the script later: **Deploy → Manage deployments → ✎ → Version: New version → Deploy**. That keeps the same URL.

## 4. Get a roster from Canvas

The Canvas zip only has each student's Canvas ID, not their email, so the grader matches IDs using a roster.

1. Canvas → **Grades** → **Export** → **Export Current Gradebook View**. This saves a CSV with `ID` (Canvas ID) and `SIS User ID` columns.
2. In the grader, open **Email students** → **Load roster** and choose that CSV.

Email addresses are made as `<SIS User ID>@lbschools.net`. If your students' addresses are built differently, change `email.idColumn` / `email.domain` in `js/config.js`, or load any CSV that has an `ID` column and an `Email` column. The roster is kept in this browser only; **Remove** clears it (do that on a shared computer). Load a fresh export when your rosters change.

## 5. Connect and test

1. Grade a class as usual, then click **Email students**.
2. Paste the **Mailer URL** (remembered in this browser) and the **Mailer key** (kept for this tab only, so you type it each session).
3. Click **Test connection**. It should say *Connected. Sends from you@lbschools.net*.
   - **Could not reach the mailer**: check that the deployment's access is *Anyone*. If your district blocks that option, the web-app mailer won't work there. Use **Export CSV** with a mail merge instead.
   - **Wrong mailer key**: re-copy the key from Script Properties.
4. Leave **Test run** checked and click **Send test emails to me**. The first 3 selected students' emails go to *your* inbox, with the student's address in the subject. Check one.

## Sending for real

1. Open **Email students**. Every student is listed with their roster name, address and score.
   - **Not on roster / Not graded / Marked CHECK**: can't be selected.
   - **Roster name differs**: the Canvas file name doesn't match the roster name for that ID. It's left unchecked; look before you tick it.
   - **Sent (date)**: already emailed for this assignment; left unchecked.
2. Uncheck **Test run**. The button turns red and says *Send N emails to students*.
3. Click it and confirm. Each row shows **Sent** or the reason it failed. **Stop** halts after the current email.

The score in the email is the **Final** column, so make overrides before sending.

## Good to know

- **No double sends.** The mailer logs every email on the Sheet's **Sent log** tab and refuses to send the same assignment to the same student twice. To resend (say, after a regrade), delete that student's row in the log.
- **Daily limit.** Google allows about 1,500 emails a day from a school account. **Test connection** shows how many are left.
- **What's in the email.** The subject and opening lines come from `email.subject` and `email.intro` in `js/config.js` (`{first}`, `{assignment}` and `{score}` are filled in), followed by the same feedback as **Copy for Canvas**, and the correction-sheet PDF if **Attach** is checked.
- **Privacy.** Student work still never leaves the browser while it's graded. Only the emails you choose to send go out, through your own Google account.
