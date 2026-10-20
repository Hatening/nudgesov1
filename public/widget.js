(function () {
  var script = document.currentScript;
  var key = '';
  try {
    key = script ? new URL(script.src).searchParams.get('key') || '' : '';
  } catch (err) {
    key = '';
  }

  var button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Chat with support';
  button.setAttribute('data-relaydesk-widget', key);
  button.style.cssText = [
    'position:fixed',
    'right:20px',
    'bottom:20px',
    'z-index:2147483000',
    'border:0',
    'border-radius:999px',
    'padding:14px 18px',
    'background:#5b5bd6',
    'color:#fff',
    'font:600 14px/1.2 Inter,system-ui,sans-serif',
    'box-shadow:0 10px 28px rgba(30,41,59,.28)',
    'cursor:pointer'
  ].join(';');

  button.addEventListener('click', function () {
    var url = '/chat.html?site=' + encodeURIComponent(key);
    window.open(url, '_blank', 'noopener');
  });

  document.body.appendChild(button);
})();
