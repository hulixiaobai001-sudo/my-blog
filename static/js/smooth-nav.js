(function() {
  var loading = false;
  function navigate(url, pushState) {
    if (loading) return;
    loading = true;
    document.body.style.opacity = '0.6';
    fetch(url, { headers: { 'X-PJAX': '1' } })
      .then(function(r) { return r.text(); })
      .then(function(html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var newMain = doc.querySelector('main');
        var oldMain = document.querySelector('main');
        if (newMain && oldMain) {
          oldMain.innerHTML = newMain.innerHTML;
        }
        document.title = doc.title;
        if (pushState) history.pushState({}, '', url);
        window.scrollTo(0, 0);
        var scripts = doc.querySelectorAll('main script');
        scripts.forEach(function(s) {
          var ns = document.createElement('script');
          ns.textContent = s.textContent;
          document.querySelector('main').appendChild(ns);
        });
      })
      .catch(function() { window.location.href = url; })
      .finally(function() {
        loading = false;
        document.body.style.opacity = '1';
      });
  }
  document.addEventListener('click', function(e) {
    var a = e.target.closest('a');
    if (!a) return;
    var href = a.getAttribute('href');
    if (!href || href.charAt(0) === '#' || href.indexOf('http') === 0 || href.indexOf('mailto:') === 0 || href.indexOf('javascript:') === 0 || a.target === '_blank') return;
    e.preventDefault();
    navigate(href, true);
  });
  window.addEventListener('popstate', function() {
    navigate(location.pathname, false);
  });
})();
