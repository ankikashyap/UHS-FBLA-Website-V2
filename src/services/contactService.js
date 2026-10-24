import { addDoc, collection } from 'firebase/firestore'
import { db, auth } from '../firebaseConfig.js'

const CONTACT_COL = 'contactMessages'
const WEB3FORMS_URL = 'https://api.web3forms.com/submit'

/**
 * Store a Contact-page message in Firestore.
 *
 * Submissions are open to signed-out visitors — this is a public contact form,
 * not a member feature — so `authorUid` is null unless someone happens to be
 * signed in. The matching rule in firestore.rules allows create only, and
 * validates every field below; reads happen in the Firebase console.
 *
 * The field list here and the `hasOnly([...])` list in firestore.rules must
 * stay in sync, or every write fails with permission-denied.
 */
async function saveToFirestore(data) {
  const ref = await addDoc(collection(db, CONTACT_COL), {
    ...data,
    authorUid: auth.currentUser?.uid ?? null,
    createdAt: new Date().toISOString(),
    handled: false,
  })
  return ref.id
}

/**
 * Email the message to the chapter inbox via Web3Forms. The access key is tied
 * to the inbox it delivers to (set up at web3forms.com), so there is no
 * recipient address here. Setting `email` makes "Reply" go to the visitor.
 */
async function sendEmail({ firstName, lastName, email, subject, message }) {
  const accessKey = import.meta.env.VITE_WEB3FORMS_ACCESS_KEY
  if (!accessKey) throw new Error('VITE_WEB3FORMS_ACCESS_KEY is not set')

  const res = await fetch(WEB3FORMS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      access_key: accessKey,
      subject: `FBLA Contact: ${subject}`,
      from_name: 'Urbana FBLA Website',
      name: `${firstName} ${lastName}`,
      email,
      topic: subject,
      message,
    }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || !body.success) {
    throw new Error(body.message || `Web3Forms request failed (${res.status})`)
  }
}

/**
 * Send a Contact-page message: emailed to the chapter Gmail, with a copy kept
 * in Firestore. Succeeds if either delivery works, so one service being down
 * doesn't lose the message; throws the email error if both fail.
 */
export async function addContactMessage({ firstName, lastName, email, subject, message }) {
  const data = {
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    email: email.trim(),
    subject,
    message: message.trim(),
  }

  const [emailed, saved] = await Promise.allSettled([sendEmail(data), saveToFirestore(data)])
  if (emailed.status === 'rejected') console.error('Contact email failed:', emailed.reason)
  if (saved.status === 'rejected') console.error('Contact Firestore save failed:', saved.reason)
  if (emailed.status === 'rejected' && saved.status === 'rejected') throw emailed.reason

  return { id: saved.value ?? null, ...data }
}
