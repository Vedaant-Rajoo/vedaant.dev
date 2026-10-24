// The 404 page's copy, as the owner's design writes it. The middle part of `lead`
// is marked; the middle part of `report` is the link text.
export const notFound = {
  status: 'not found · last seen: never',
  lead: [
    'Nothing lives at this address. Either it never did, or I moved it and ',
    'forgot to leave a note',
    '.',
  ],
  report: ['If a link I published brought you here, ', 'tell me', ' and I will fix it.'],
  // True only once the page's script has put the path in the subject, so it shows only with JS.
  note: 'The email opens with the address already in the subject.',
} as const;

// The report email's subject, in the owner's words. The page's script imports only this, so
// the rest of the copy stays out of the page's JavaScript.
export const subject = (path: string) => `404d on ${path} on your site`;
