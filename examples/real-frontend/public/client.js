// Consumer-owned browser client. No canned model text or tool implementation.
const form = document.querySelector('form');
const prompt = document.querySelector('#prompt');
const send = document.querySelector('#send');
const cancel = document.querySelector('#cancel');
const status = document.querySelector('[role=status]');
const reply = document.querySelector('#reply');
const post = (path, body) => fetch(path, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  send.disabled = true;
  cancel.disabled = false;
  reply.textContent = '';
  status.textContent = 'Running';
  try {
    const response = await post('/api/prompt', { prompt: prompt.value });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    reply.textContent = result.text ?? '';
    status.textContent = result.cancelled ? 'Cancelled' : 'Complete';
  } catch (error) {
    status.textContent = 'Error';
    reply.textContent = error.message;
  } finally {
    send.disabled = false;
    cancel.disabled = true;
  }
});
cancel.addEventListener('click', async () => {
  cancel.disabled = true;
  try {
    const response = await post('/api/cancel', {});
    if (!response.ok) throw new Error('Cancellation failed');
  } catch (error) { status.textContent = error.message; }
});
