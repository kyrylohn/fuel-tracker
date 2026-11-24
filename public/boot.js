/* Діагностика старту і реєстрація сервіс-воркера (офлайн і встановлення на телефон) */
(function(){
  var T = (window.FuelI18n && window.FuelI18n.t) || function(s){ return s; };
  var bootEl = document.querySelector('.boot'); if (bootEl) bootEl.textContent = T('Завантажую…');
  function show(title, text){
    var app = document.getElementById('app'); if (!app) return;
    app.innerHTML = '<div style="padding:40px 4px;max-width:520px;margin:0 auto">' +
      '<h1 style="font-size:24px;margin:0 0 10px"></h1><p style="color:var(--muted);white-space:pre-wrap;word-break:break-word"></p>' +
      '<button style="margin-top:14px;padding:12px 16px;border:0;border-radius:12px;background:var(--accent);color:var(--accent-ink);font-size:16px">' + T('Оновити сторінку') + '</button></div>';
    app.querySelector('h1').textContent = title;
    app.querySelector('p').textContent = text;
    app.querySelector('button').addEventListener('click', function(){ location.reload(); });
  }
  window.__fuelShow = show;
  window.addEventListener('error', function(e){
    if (window.__fuelLoaded) return;
    show(T('Застосунок не запустився'), T('Помилка в коді: ') + (e.message || e) + (e.lineno ? T(' (рядок {n})', { n: e.lineno }) : ''));
  });
  setTimeout(function(){
    if (window.__fuelLoaded) return;
    show(T('Сервер не відповідає'), T('Застосунок чекає на відповідь домашнього сервера вже 30 секунд.\n\nПеревірте, що ви вдома або телефон підключений до домашнього VPN (WireGuard).'));
  }, 30000);

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')){
    window.addEventListener('load', function(){
      navigator.serviceWorker.register('/sw.js').catch(function(err){ console.warn('sw', err); });
    });
  }
})();
