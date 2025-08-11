<script>
(function(){
  // Example minimal embed without a bundler
  // Replace SESSION_ENDPOINT with your backend endpoint that creates a PSB session
  fetch('/api/create-psb-session', { method:'POST' }).then(r=>r.json()).then(({ iframe_url })=>{
    var iframe = document.createElement('iframe');
    iframe.src = iframe_url;
    iframe.style.width = '420px';
    iframe.style.height = '420px';
    iframe.style.border = '0';
    iframe.style.borderRadius = '12px';
    document.getElementById('psb-root').appendChild(iframe);

    window.addEventListener('message', function(e){
      if (!e || !e.data || e.origin !== new URL(iframe_url).origin) return;
      if (e.data.source !== 'psb-widget') return;
      console.log('PSB event', e.data);
      // Handle types: created, submitted, queued, started, otp_required, error, final, completed
    });
  });
})();
</script>