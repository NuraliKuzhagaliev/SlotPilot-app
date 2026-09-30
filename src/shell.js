'use strict';
const bridge = window.slotpilotDesktop;
const status = document.getElementById('status');
const panel = document.getElementById('panel');
const heading = document.getElementById('heading');
const description = document.getElementById('description');
const retry = document.getElementById('retry');

bridge.onState(state => {
  status.dataset.kind = state.kind;
  status.textContent = state.kind === 'ready' ? 'Connected' : state.kind === 'error' ? 'Connection lost' : 'Connecting…';
  panel.hidden = state.kind === 'ready';
  heading.textContent = state.kind === 'error' ? 'Unable to connect' : 'Connecting to your workshop';
  description.textContent = state.kind === 'error'
    ? 'Check your internet connection and try again. If you already confirmed a booking, check its status after reconnecting before booking again.'
    : 'Loading your visit and the available schedule.';
  retry.hidden = state.kind !== 'error';
  document.querySelectorAll('nav button').forEach(button => {
    button.setAttribute('aria-selected', String(button.dataset.command === state.route));
    const tab = state.tabs?.find(tab => tab.route === button.dataset.command);
    button.classList.toggle('audible', tab?.audible === true);
    if (button.dataset.command === state.route) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
});

document.querySelector('nav').addEventListener('keydown', event => {
  const buttons = [...document.querySelectorAll('nav button')];
  const index = buttons.indexOf(event.target);
  if (index < 0) return;
  let next;
  if (event.key === 'ArrowRight') next = (index + 1) % buttons.length;
  if (event.key === 'ArrowLeft') next = (index + buttons.length - 1) % buttons.length;
  if (event.key === 'Home') next = 0;
  if (event.key === 'End') next = buttons.length - 1;
  if (next === undefined) return;
  event.preventDefault();
  buttons[next].focus();
  buttons[next].click();
});

document.querySelectorAll('[data-command]').forEach(button => {
  button.addEventListener('click', async () => {
    button.disabled = true;
    try { await bridge.command(button.dataset.command); }
    catch { status.textContent = 'Command unavailable. Please try again.'; }
    finally { button.disabled = false; }
  });
});
bridge.command('state').catch(() => { status.textContent = 'Startup error'; });
