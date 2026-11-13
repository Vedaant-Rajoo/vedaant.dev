// With JS, a click on an email link copies the address instead of opening the mail
// client, and the link reads "copied" for 1.5 s. A click with a modifier key, a browser without
// the Clipboard API and a failed copy open the mailto: link as before.
const status = document.getElementById('copy-status') as HTMLElement;
let announcer: HTMLAnchorElement | undefined;
for (const link of document.querySelectorAll<HTMLAnchorElement>('a[data-copy]')) {
  const address = decodeURIComponent(link.pathname);
  const text = link.firstElementChild as HTMLElement;
  const label = [...text.childNodes];
  let clicks = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  link.addEventListener('click', (event) => {
    if (!navigator.clipboard || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    const click = ++clicks;
    navigator.clipboard.writeText(address).then(
      () => {
        // "copied" is narrower than "email →": the span keeps its width, so nothing moves.
        text.style.width = `${text.getBoundingClientRect().width}px`;
        text.textContent = 'copied';
        status.textContent = 'copied';
        announcer = link;
        clearTimeout(timer);
        timer = setTimeout(() => {
          text.replaceChildren(...label);
          text.style.width = '';
          // One region serves every link: only the link that wrote it last empties it.
          if (announcer === link) {
            status.textContent = '';
          }
        }, 1500);
      },
      () => {
        // A failed copy opens the mail client, unless a later click on this link replaced it.
        if (click === clicks) {
          location.href = link.href;
        }
      },
    );
  });
}

// A module, so `status` is this file's own, not window.status.
export {};
