// CSRF helper
function getCookie(name) {
  const v = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
  return v ? v.pop() : '';
}
const CSRF = getCookie('csrftoken');

async function safeJson(res) {
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await res.text();
    return { __error: true, status: res.status, text };
  }

  try {
    return await res.json();
  } catch (err) {
    return { __error: true, status: res.status, text: String(err) };
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const requestsContainer = document.getElementById('requests-container');
  const closedContainer = document.getElementById('closed-requests-container');
  const acceptedContainer = document.getElementById('accepted-requests-container');
  const createForm = document.getElementById('create-request-form');
  const showClosedBtn = document.getElementById('show-closed-btn');
  const showAcceptedBtn = document.getElementById('show-accepted-btn');
  const showOpenBtns = document.querySelectorAll('#show-open-btn');
  const role = window.currentUserRole || '';
  const mapEl = document.getElementById('requests-map');
  let map = null;
  let markersLayer = null;

  function formatRoute(pickup, destination) {
    const isRtl = (document.documentElement.dir || '').toLowerCase() === 'rtl';
    const arrow = isRtl ? '←' : '→';
    return `${pickup} ${arrow} ${destination}`;
  }

  function showPanel(el) {
  if (!el) return;
  el.style.display = "block"; // נשאר block תמיד
  el.classList.remove("panel-hidden");
  el.classList.add("panel-visible");
}

function hidePanel(el) {
  if (!el) return;
  el.style.display = "block"; // ❌ לא לשים none
  el.classList.remove("panel-visible");
  el.classList.add("panel-hidden");
}


  showPanel(requestsContainer);
  hidePanel(closedContainer);
  hidePanel(acceptedContainer);
  
  function initMap() {
    if (!mapEl || !window.L || map) return;

    map = L.map(mapEl).setView([32.0853, 34.7818], 10);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 18,
    }).addTo(map);

    markersLayer = L.layerGroup().addTo(map);
  }

  function updateMapMarkers(requests) {
    if (!map || !markersLayer) return;

    markersLayer.clearLayers();
    const points = [];

    requests.forEach(r => {
      const lat = Number(r.pickup_lat);
      const lng = Number(r.pickup_lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

      const marker = L.marker([lat, lng]);
      marker.bindPopup(`${formatRoute(r.pickup, r.destination)}<br>${r.requested_time}`);
      marker.addTo(markersLayer);
      points.push([lat, lng]);
    });

    if (points.length > 0) {
      map.fitBounds(points, { padding: [20, 20] });
    }
  }

  async function loadOpenRequests() {
    if (!requestsContainer) return;
    try {
      const res = await fetch('/api/requests/');
      const json = await safeJson(res);
      if (json.__error) {
        requestsContainer.innerHTML = '<p class="no-requests">שגיאת שרת. נסה להתחבר מחדש.</p>';
        return;
      }

      if (!json.requests) {
        requestsContainer.innerHTML = '<p class="no-requests">שגיאה בטעינת בקשות.</p>';
        return;
      }

      const reqs = json.requests.filter(r =>
        role === 'volunteer' ? r.status === 'open' : r.status === 'open' || r.status === 'accepted'
      );

      requestsContainer.innerHTML = '';

      if (reqs.length === 0) {
        requestsContainer.innerHTML = '<p class="no-requests">אין בקשות פתוחות.</p>';
        return;
      }

      reqs.forEach(r => {
        const card = document.createElement('div');
        card.className = 'request-card ' + (r.status === 'open' ? 'open' : r.status);

        let volHtml = '';
        if (r.volunteer) {
          volHtml = `<div class="volunteer-info">מתנדב: ${r.volunteer.username} — ${r.volunteer.phone || '-'}</div>`;
        } else if (r.no_volunteers_available) {
          volHtml = `<div class="volunteer-info no-volunteers">אין מתנדבים זמינים</div>`;
        }

        card.innerHTML = `
          <div class="request-info">
            <div class="route">${formatRoute(r.pickup, r.destination)}</div>
            <div class="status">${r.requested_time} · ${r.status_display}</div>
            <div style="margin-top:6px">הערות: ${r.notes || '-'}</div>
            <div style="margin-top:6px">טלפון מטופל: ${r.phone || '-'}</div>
            ${volHtml}
          </div>
        `;

        // מטופל: ביטול
        if (role === 'sick' && r.status === 'open' && Number(r.sick_id) === Number(window.currentUserId)) {
          const cancelBtn = document.createElement('button');
          cancelBtn.className = 'button';
          cancelBtn.textContent = 'בטל';
          cancelBtn.onclick = async () => {
            if (!confirm('לבטל את הבקשה?')) return;
            await fetch(`/api/requests/cancel/${r.id}/`, {
              method: 'POST',
              headers: { 'X-CSRFToken': CSRF },
            });
            loadOpenRequests();
          };
          card.appendChild(cancelBtn);
        }

        // מתנדב: קבל + דחה
        if (role === 'volunteer' && r.status === 'open') {
          const acceptBtn = document.createElement('button');
          acceptBtn.className = 'accept-btn';
          acceptBtn.textContent = 'קבל';
          acceptBtn.onclick = async () => {
            await fetch(`/api/requests/accept/${r.id}/`, {
              method: 'POST',
              headers: { 'X-CSRFToken': CSRF },
            });
            loadOpenRequests();
          };

          const rejectBtn = document.createElement('button');
          rejectBtn.className = 'button';
          rejectBtn.textContent = 'דחה';
          rejectBtn.onclick = async () => {
            const reason = prompt('סיבת דחייה (לא חובה):');
            await fetch(`/api/requests/reject/${r.id}/`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-CSRFToken': CSRF },
              body: JSON.stringify({ reason }),
            });
            loadOpenRequests();
          };

          card.appendChild(acceptBtn);
          card.appendChild(rejectBtn);
        }

        requestsContainer.appendChild(card);
      });

      if (role === 'volunteer') {
        initMap();
        updateMapMarkers(reqs);
      }
    } catch (err) {
      console.error(err);
      requestsContainer.innerHTML = '<p class="no-requests">בעיית תקשורת.</p>';
    }
  }

  function isVisible(el) {
    return el && !el.classList.contains('panel-hidden');
  }

  async function loadClosedRequests() {
    if (!closedContainer) return;

    showPanel(closedContainer);
    hidePanel(requestsContainer);
    hidePanel(acceptedContainer);

    closedContainer.innerHTML = '<p>...טוען בקשות סגורות</p>';

    try {
      const res = await fetch('/api/requests/closed/');
      const json = await safeJson(res);
      if (json.__error) {
        closedContainer.innerHTML = '<p class="no-requests">שגיאת שרת. נסה להתחבר מחדש.</p>';
        return;
      }

      if (!json || !Array.isArray(json.requests)) {
        closedContainer.innerHTML = '<p class="no-requests">שגיאה בטעינת בקשות סגורות.</p>';
        return;
      }

      const reqs = json.requests;
      closedContainer.innerHTML = '';

      if (reqs.length === 0) {
        closedContainer.innerHTML = '<p class="no-requests">אין בקשות סגורות או מבוטלות.</p>';
        return;
      }

      reqs.forEach(r => {
        const div = document.createElement('div');
        div.className = 'request-card closed';

        let extra = '';
        if (r.status === 'cancelled' && r.no_volunteers_available) {
          extra = '<div class="volunteer-info no-volunteers">אין מתנדבים זמינים</div>';
        }

        div.innerHTML = `
          <div class="request-info">
            <div class="route">${formatRoute(r.pickup, r.destination)}</div>
            <div class="status">${r.requested_time} · ${r.status_label || r.status_display}</div>
            <div style="margin-top:6px">הערות: ${r.notes || '-'}</div>
            <div style="margin-top:6px">מתנדב: ${
              r.volunteer ? `${r.volunteer.username} (${r.volunteer.phone || '-'})` : '-'
            }</div>
            ${extra}
          </div>
        `;

        const delBtn = document.createElement('button');
        delBtn.className = 'button';
        delBtn.textContent = 'מחק';
        delBtn.onclick = async () => {
          if (!confirm('למחוק את הבקשה?')) return;
          await fetch(`/api/requests/delete/${r.id}/`, {
            method: 'POST',
            headers: { 'X-CSRFToken': CSRF },
          });
          loadClosedRequests();
        };
        div.appendChild(delBtn);

        closedContainer.appendChild(div);
      });
    } catch (err) {
      console.error(err);
      closedContainer.innerHTML = '<p class="no-requests">שגיאה בטעינת בקשות סגורות.</p>';
    }
  }

  async function loadAcceptedRequests() {
    if (!acceptedContainer) return;

    showPanel(acceptedContainer);
    hidePanel(requestsContainer);
    hidePanel(closedContainer);

    acceptedContainer.innerHTML = '<p>...טוען בקשות מאושרות</p>';
    try {
      const res = await fetch('/api/requests/accepted/');
      const json = await safeJson(res);
      if (json.__error) {
        acceptedContainer.innerHTML = '<p class="no-requests">שגיאת שרת. נסה להתחבר מחדש.</p>';
        return;
      }
      const reqs = json.requests || [];
      acceptedContainer.innerHTML = '';

      if (reqs.length === 0) {
        acceptedContainer.innerHTML = '<p class="no-requests">אין בקשות מאושרות.</p>';
        return;
      }

      reqs.forEach(r => {
        const div = document.createElement('div');
        div.className = 'request-card accepted';
        div.innerHTML = `
          <div class="request-info">
            <div class="route">${formatRoute(r.pickup, r.destination)}</div>
            <div class="status">${r.requested_time} · ${r.status_display}</div>
            <div style="margin-top:6px">מטופל: ${r.sick_username} · ${r.phone || '-'}</div>
            <div style="margin-top:6px">הערות: ${r.notes || '-'}</div>
          </div>
        `;

        const doneBtn = document.createElement('button');
        doneBtn.className = 'button';
        doneBtn.textContent = 'טופל ומחק';
        doneBtn.onclick = async () => {
          if (!confirm('לסמן כטופל ולמחוק?')) return;
          await fetch(`/api/requests/delete/${r.id}/`, {
            method: 'POST',
            headers: { 'X-CSRFToken': CSRF },
          });
          loadAcceptedRequests();
        };

        div.appendChild(doneBtn);
        acceptedContainer.appendChild(div);
      });
    } catch (err) {
      console.error(err);
      acceptedContainer.innerHTML = '<p class="no-requests">שגיאה בטעינת בקשות מאושרות.</p>';
    }
  }

  function refreshFromEvent() {
    loadOpenRequests();
    if (role === 'sick' && isVisible(closedContainer)) {
      loadClosedRequests();
    }
    if (role === 'volunteer' && isVisible(acceptedContainer)) {
      loadAcceptedRequests();
    }
  }

  function connectRealtime() {
    if (!role) return;

    const wsScheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${wsScheme}://${window.location.host}/ws/requests/`;
    let socket;
    let reconnectTimer;

    const connect = () => {
      socket = new WebSocket(wsUrl);

      socket.onmessage = event => {
        try {
          const payload = JSON.parse(event.data || '{}');
          if (payload && payload.event) {
            refreshFromEvent();
          }
        } catch (err) {
          console.error('WS parse error', err);
        }
      };

      socket.onclose = () => {
        reconnectTimer = setTimeout(connect, 2000);
      };

      socket.onerror = () => {
        if (socket && socket.readyState !== WebSocket.CLOSED) {
          socket.close();
        }
      };
    };

    connect();

    window.addEventListener('beforeunload', () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.close();
      }
    });
  }

  if (showClosedBtn) {
    showClosedBtn.onclick = async () => {
      await loadClosedRequests();
      showClosedBtn.style.display = 'none';
      showOpenBtns.forEach(b => (b.style.display = 'inline-block'));
      if (requestsContainer) hidePanel(requestsContainer);
    };
  }

  if (showAcceptedBtn) {
    showAcceptedBtn.onclick = async () => {
      await loadAcceptedRequests();
      showAcceptedBtn.style.display = 'none';
      showOpenBtns.forEach(b => (b.style.display = 'inline-block'));
      if (requestsContainer) hidePanel(requestsContainer);
    };
  }

  showOpenBtns.forEach(b => {
    b.onclick = async () => {
      hidePanel(closedContainer);
      hidePanel(acceptedContainer);

      showOpenBtns.forEach(s => (s.style.display = 'none'));
      if (showClosedBtn) showClosedBtn.style.display = 'inline-block';
      if (showAcceptedBtn) showAcceptedBtn.style.display = 'inline-block';

      showPanel(requestsContainer);
      await loadOpenRequests();
    };
  });

  if (createForm) {
    createForm.onsubmit = async e => {
      e.preventDefault();
      const payload = {
        pickup: createForm.querySelector('[name=pickup]').value,
        destination: createForm.querySelector('[name=destination]').value,
        time: createForm.querySelector('[name=time]').value,
        notes: createForm.querySelector('[name=notes]').value,
        phone: createForm.querySelector('[name=phone]').value,
        pickup_lat: createForm.querySelector('[name=pickup_lat]').value,
        pickup_lng: createForm.querySelector('[name=pickup_lng]').value,
        dest_lat: createForm.querySelector('[name=dest_lat]').value,
        dest_lng: createForm.querySelector('[name=dest_lng]').value,
      };

      try {
        const res = await fetch('/api/requests/create/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRFToken': CSRF },
          body: JSON.stringify(payload),
        });
        const json = await safeJson(res);
        if (json.__error) {
          alert('שגיאת שרת. נסה להתחבר מחדש.');
          return;
        }

        if (json.success) {
          createForm.reset();
          await loadOpenRequests();
        } else {
          alert(json.error || 'נכשל ביצירת בקשה');
        }
      } catch (err) {
        console.error(err);
        alert('בעיית תקשורת');
      }
    };
  }

  if (role === 'volunteer') {
    initMap();
  }
  connectRealtime();
  loadOpenRequests();
});
