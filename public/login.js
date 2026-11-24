(function(){
  var T = (window.FuelI18n && window.FuelI18n.t) || function(s){ return s; };
  Array.prototype.forEach.call(document.querySelectorAll('[data-t]'), function(el){ el.textContent = T(el.textContent); });
  var f = document.getElementById('f'), err = document.getElementById('err'), go = document.getElementById('go');
  var next = '/';
  try {
    var u = new URL(new URLSearchParams(location.search).get('next') || '/', location.origin);
    if (u.origin === location.origin && u.pathname !== '/login' && u.pathname.indexOf('/login/') !== 0) next = u.pathname + u.search + u.hash;
  } catch (e) {}
  f.addEventListener('submit', function(e){
    e.preventDefault();
    err.textContent = ''; go.disabled = true; go.textContent = T('Входжу…');
    fetch('/api/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: f.login.value.trim(), password: f.password.value }) })
      .then(function(r){ return r.json().catch(function(){ return {}; }).then(function(d){ return { ok: r.ok, d: d }; }); })
      .then(function(x){
        if (x.ok){ location.replace(next); return; }
        err.textContent = (x.d && x.d.error) || T('Не вдалося увійти');
        go.disabled = false; go.textContent = T('Увійти'); f.password.select();
      })
      .catch(function(){ err.textContent = T('Немає зв’язку з сервером. Ви вдома або у VPN?'); go.disabled = false; go.textContent = T('Увійти'); });
  });
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('/sw.js').catch(function(){});
})();
