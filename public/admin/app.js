/*
  The Ridge CMS — admin single-page app (vanilla JS, no build, no deps).

  Served statically at /admin/ behind Cloudflare Access. Talks to the /cms/*
  API (see the build contract). Same-origin fetch means the Access cookie is
  sent automatically; a 401 anywhere means the session expired.

  Sections below:
    - Field spec (mirrors the CMS field spec / content schema)
    - Small helpers (DOM, escaping, markdown, image downscale)
    - API layer (with shared 401 handling)
    - Views (collection list, edit form + live preview, moderation)
    - Router + boot
*/
(function () {
  'use strict';

  // ---- Collections shown in the left nav (label + slug + which field titles a row) ----
  var COLLECTIONS = [
    { type: 'events', label: 'Events', titleKey: 'title', singular: 'event' },
    { type: 'news', label: 'News', titleKey: 'title', singular: 'post' },
    { type: 'positions', label: 'Voice to the City', titleKey: 'title', singular: 'position' },
    { type: 'groups', label: 'Groups', titleKey: 'name', singular: 'group' },
    { type: 'meetings', label: 'Meetings', titleKey: 'title', singular: 'meeting' },
    { type: 'gallery', label: 'Gallery', titleKey: 'caption', singular: 'photo' }
  ];

  // ---- Field spec per collection (canonical, from the contract). `body` handled separately. ----
  var FIELDS = {
    events: [
      { key: 'title', label: 'Title', type: 'text', required: true },
      { key: 'start', label: 'Start date', type: 'date', required: true },
      { key: 'end', label: 'End date', type: 'date' },
      { key: 'time', label: 'Time', type: 'text', placeholder: 'e.g. 6:30 PM – 7:45 PM' },
      { key: 'location', label: 'Location', type: 'text' },
      { key: 'summary', label: 'Summary', type: 'textarea', required: true },
      { key: 'coordinator', label: 'Coordinator', type: 'text' },
      { key: 'coordinatorEmail', label: 'Coordinator email', type: 'text' },
      { key: 'bring', label: 'What to bring', type: 'text' },
      { key: 'rsvp', label: 'Show an RSVP button', type: 'checkbox', default: true },
      { key: 'example', label: 'Suggested (example) event', type: 'checkbox', default: false },
      { key: 'image', label: 'Photo', type: 'media' },
      { key: 'imageAlt', label: 'Photo description (alt text)', type: 'text' }
    ],
    news: [
      { key: 'title', label: 'Title', type: 'text', required: true },
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'category', label: 'Category', type: 'select', options: ['Announcement', 'Development', 'Vision'], default: 'Announcement' },
      { key: 'summary', label: 'Summary', type: 'textarea', required: true },
      { key: 'author', label: 'Author', type: 'text' },
      { key: 'image', label: 'Photo', type: 'media' },
      { key: 'imageAlt', label: 'Photo description (alt text)', type: 'text' },
      { key: 'pinned', label: 'Pin to the top', type: 'checkbox', default: false }
    ],
    positions: [
      { key: 'title', label: 'Title', type: 'text', required: true },
      { key: 'status', label: 'Status', type: 'select', options: ['Watching', 'Active', 'Resolved'], default: 'Watching' },
      { key: 'updated', label: 'Last updated', type: 'date', required: true },
      { key: 'summary', label: 'Summary', type: 'textarea', required: true },
      { key: 'whatYouCanDo', label: 'What you can do', type: 'string-list' }
    ],
    groups: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'kind', label: 'Kind', type: 'select', options: ['Dog walk', 'People walk', 'Bike ride', 'Other'], default: 'Other' },
      { key: 'schedule', label: 'Schedule', type: 'text', required: true, placeholder: 'e.g. Saturdays, 9:00 AM' },
      { key: 'meetingPoint', label: 'Meeting point', type: 'text', required: true },
      { key: 'coordinator', label: 'Coordinator', type: 'text' },
      { key: 'summary', label: 'Summary', type: 'textarea', required: true },
      { key: 'order', label: 'Sort order', type: 'number', default: 50 }
    ],
    meetings: [
      { key: 'title', label: 'Title', type: 'text', required: true },
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'kind', label: 'Kind', type: 'text', placeholder: 'e.g. Council' },
      { key: 'agendaUrl', label: 'Agenda link', type: 'text' },
      { key: 'note', label: 'Note', type: 'text' }
    ],
    gallery: [
      { key: 'image', label: 'Photo', type: 'media', required: true },
      { key: 'caption', label: 'Caption', type: 'text' },
      { key: 'credit', label: 'Credit', type: 'text' },
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'alt', label: 'Photo description (alt text)', type: 'text' },
      { key: 'order', label: 'Sort order', type: 'number', default: 50 }
    ]
  };

  // Which R2 prefix an upload from this collection goes to (news|events|gallery only).
  function mediaPrefix(type) {
    return type === 'events' ? 'events' : type === 'gallery' ? 'gallery' : 'news';
  }

  var state = { email: '', current: null, sessionDead: false };

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------

  // Tiny hyperscript-style DOM builder.
  function h(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        var v = attrs[k];
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'for') node.htmlFor = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
        else if (v === true) node.setAttribute(k, '');
        else if (v !== false && v != null) node.setAttribute(k, v);
      }
    }
    for (var i = 2; i < arguments.length; i++) {
      var kid = arguments[i];
      if (kid == null || kid === false) continue;
      if (Array.isArray(kid)) {
        for (var j = 0; j < kid.length; j++) if (kid[j] != null) node.appendChild(nodeOf(kid[j]));
      } else {
        node.appendChild(nodeOf(kid));
      }
    }
    return node;
  }
  function nodeOf(x) {
    return typeof x === 'string' || typeof x === 'number' ? document.createTextNode(String(x)) : x;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;';
    });
  }

  function slugify(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
  }

  function todayISO() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function formatWhen(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso || '');
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function isEmpty(v) {
    if (v == null) return true;
    if (Array.isArray(v)) return v.filter(Boolean).length === 0;
    return String(v).trim() === '';
  }

  // Minimal, safe markdown → HTML (input is escaped first, so no raw HTML passes).
  // Supports: #..###### headings, **bold**, _italic_, [text](url), - lists, paragraphs.
  function renderMarkdown(src) {
    var lines = escapeHtml(src).split(/\r?\n/);
    var out = [];
    var para = [];
    var list = [];
    function inline(s) {
      s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (m, text, url) {
        var safe = /^(https?:\/\/|\/|mailto:|#)/i.test(url) ? url : '#';
        return '<a href="' + safe + '" target="_blank" rel="noopener">' + text + '</a>';
      });
      s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      s = s.replace(/_([^_]+)_/g, '<em>$1</em>');
      return s;
    }
    function flushPara() {
      if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; }
    }
    function flushList() {
      if (list.length) {
        out.push('<ul>' + list.map(function (li) { return '<li>' + inline(li) + '</li>'; }).join('') + '</ul>');
        list = [];
      }
    }
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var head = line.match(/^(#{1,6})\s+(.*)$/);
      var item = line.match(/^\s*[-*]\s+(.*)$/);
      if (head) {
        flushPara(); flushList();
        var lvl = head[1].length;
        out.push('<h' + lvl + '>' + inline(head[2]) + '</h' + lvl + '>');
      } else if (item) {
        flushPara();
        list.push(item[1]);
      } else if (line.trim() === '') {
        flushPara(); flushList();
      } else {
        flushList();
        para.push(line.trim());
      }
    }
    flushPara(); flushList();
    return out.join('\n');
  }

  // Client-side downscale: longest edge <= 2000px, re-encode JPEG q0.85 (also
  // strips EXIF/GPS). Returns a Blob. A white matte handles transparent PNGs.
  function downscaleImage(file, maxEdge, quality) {
    maxEdge = maxEdge || 2000;
    quality = quality || 0.85;
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        var w = img.naturalWidth || img.width;
        var hgt = img.naturalHeight || img.height;
        if (!w || !hgt) { reject(new Error('That image looks empty.')); return; }
        var longest = Math.max(w, hgt);
        if (longest > maxEdge) {
          var scale = maxEdge / longest;
          w = Math.round(w * scale);
          hgt = Math.round(hgt * scale);
        }
        var canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = hgt;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, hgt);
        ctx.drawImage(img, 0, 0, w, hgt);
        canvas.toBlob(function (blob) {
          if (blob) resolve(blob); else reject(new Error('Could not process that image.'));
        }, 'image/jpeg', quality);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('Could not read that image.'));
      };
      img.src = url;
    });
  }

  // ---------------------------------------------------------------------------
  // API layer — same-origin fetch; a 401 anywhere ends the session.
  // ---------------------------------------------------------------------------
  function apiFetch(path, opts) {
    return fetch(path, opts).then(function (res) {
      if (res.status === 401) {
        showSessionExpired();
        throw new Error('unauthorized');
      }
      return res;
    });
  }

  function uploadImage(file, prefix) {
    return downscaleImage(file).then(function (blob) {
      var fd = new FormData();
      fd.append('file', blob, 'photo.jpg');
      return apiFetch('/cms/media?prefix=' + encodeURIComponent(prefix), { method: 'POST', body: fd });
    }).then(function (res) {
      if (!res.ok) throw new Error('Upload failed (' + res.status + ').');
      return res.json();
    }).then(function (data) {
      if (!data || !data.url) throw new Error('Upload did not return a URL.');
      return data.url;
    });
  }

  // ---------------------------------------------------------------------------
  // Chrome: header + sidebar + main, re-rendered on every route change.
  // ---------------------------------------------------------------------------
  function render() {
    var app = document.getElementById('app');
    app.innerHTML = '';
    app.appendChild(buildTopbar());
    var layout = h('div', { class: 'layout' });
    layout.appendChild(buildSidebar());
    var main = h('main', { class: 'main', id: 'main' });
    layout.appendChild(main);
    app.appendChild(layout);
    renderRoute(main);
  }

  function buildTopbar() {
    return h('header', { class: 'topbar' },
      h('div', { class: 'brand' }, 'The Ridge', h('small', {}, 'CMS')),
      h('div', { class: 'who', title: state.email }, state.email ? 'Signed in · ' + state.email : '')
    );
  }

  function buildSidebar() {
    var hash = location.hash || '';
    var m = hash.match(/^#\/(?:c|new|edit)\/([^\/]+)/);
    var activeType = m ? decodeURIComponent(m[1]) : '';
    var onMod = hash.indexOf('#/moderation') === 0;

    var nav = h('nav', { class: 'sidebar' });
    nav.appendChild(h('div', { class: 'nav-group-label' }, 'Collections'));
    COLLECTIONS.forEach(function (c) {
      nav.appendChild(h('button', {
        class: 'nav-item' + (c.type === activeType ? ' active' : ''),
        onClick: function () { location.hash = '#/c/' + c.type; }
      }, c.label));
    });
    nav.appendChild(h('div', { class: 'nav-group-label' }, 'Review'));
    nav.appendChild(h('button', {
      class: 'nav-item' + (onMod ? ' active' : ''),
      onClick: function () { location.hash = '#/moderation'; }
    }, 'Photo submissions'));
    return nav;
  }

  function errorBox(err) {
    return h('div', { class: 'error-box' }, (err && err.message) ? err.message : 'Something went wrong.');
  }

  // ---------------------------------------------------------------------------
  // View: collection list
  // ---------------------------------------------------------------------------
  function viewCollectionList(main, type) {
    var coll = collFor(type);
    if (!coll) { main.appendChild(errorBox(new Error('Unknown collection.'))); return Promise.resolve(); }
    main.appendChild(h('div', { class: 'view-head' },
      h('h1', {}, coll.label),
      h('button', { class: 'btn btn-primary', onClick: function () { location.hash = '#/new/' + type; } }, 'New')
    ));
    var listEl = h('div', { class: 'list' }, h('div', { class: 'muted' }, 'Loading…'));
    main.appendChild(listEl);

    return apiFetch('/cms/collections/' + type).then(function (res) {
      if (!res.ok) throw new Error('Could not load ' + coll.label + '.');
      return res.json();
    }).then(function (data) {
      var items = (data && data.items) || [];
      listEl.innerHTML = '';
      if (!items.length) {
        listEl.appendChild(h('div', { class: 'empty' }, 'Nothing here yet. Use “New” to add the first one.'));
        return;
      }
      items.forEach(function (it) {
        listEl.appendChild(h('button', {
          class: 'row',
          onClick: function () { location.hash = '#/edit/' + type + '/' + encodeURIComponent(it.id); }
        },
          h('span', { class: 'row-title' }, it.title || it.id),
          it.draft
            ? h('span', { class: 'badge badge-draft' }, 'Draft')
            : h('span', { class: 'badge badge-live' }, 'Published')
        ));
      });
    }).catch(function (err) {
      if (err.message === 'unauthorized') return;
      listEl.innerHTML = '';
      listEl.appendChild(errorBox(err));
    });
  }

  // ---------------------------------------------------------------------------
  // View: edit form + live preview
  // ---------------------------------------------------------------------------
  function viewEdit(main, type, id) {
    var coll = collFor(type);
    if (!coll) { main.appendChild(errorBox(new Error('Unknown collection.'))); return Promise.resolve(); }
    var spec = FIELDS[type];
    var isNew = id == null;

    if (isNew) {
      var data = {};
      spec.forEach(function (f) { if (f.default !== undefined) data[f.key] = f.default; });
      state.current = { type: type, id: null, isNew: true, data: data, body: '', sha: null, coll: coll };
      buildEditForm(main, coll, spec);
      return Promise.resolve();
    }

    main.appendChild(h('div', { class: 'muted' }, 'Loading…'));
    return apiFetch('/cms/item/' + type + '/' + encodeURIComponent(id)).then(function (res) {
      if (res.status === 404) throw new Error('That item could not be found.');
      if (!res.ok) throw new Error('Could not load that item.');
      return res.json();
    }).then(function (j) {
      state.current = {
        type: type, id: id, isNew: false,
        data: j.data || {}, body: j.body || '', sha: j.sha || null, coll: coll
      };
      main.innerHTML = '';
      buildEditForm(main, coll, spec);
    }).catch(function (err) {
      if (err.message === 'unauthorized') return;
      main.innerHTML = '';
      main.appendChild(errorBox(err));
    });
  }

  function buildEditForm(main, coll, spec) {
    main.appendChild(buildToolbar());
    var layout = h('div', { class: 'edit-layout' });

    var form = h('form', { class: 'editor', onSubmit: function (e) { e.preventDefault(); } });
    spec.forEach(function (f) { form.appendChild(buildField(f, state.current.data)); });

    // Body markdown field.
    var bodyTa = h('textarea', { id: 'f-body', rows: '14', class: 'body-input' });
    bodyTa.value = state.current.body || '';
    bodyTa.addEventListener('input', function () { state.current.body = bodyTa.value; updatePreview(); });
    form.appendChild(h('div', { class: 'field' },
      h('label', { for: 'f-body' }, 'Body (Markdown)'),
      bodyTa,
      h('p', { class: 'hint' }, 'Use # for headings, **bold**, _italic_, - for lists, and [text](link) for links.')
    ));

    layout.appendChild(form);
    layout.appendChild(h('div', { class: 'preview' },
      h('div', { class: 'preview-label' }, 'Live preview'),
      h('article', { class: 'preview-body' })
    ));
    main.appendChild(layout);
    updatePreview();
  }

  function buildToolbar() {
    var cur = state.current;
    var title = cur.isNew
      ? 'New ' + cur.coll.singular
      : (cur.data[cur.coll.titleKey] || cur.data.title || cur.data.name || cur.data.caption || cur.id);
    var statusPill = cur.data.draft === false
      ? h('span', { class: 'badge badge-live' }, 'Published')
      : h('span', { class: 'badge badge-draft' }, 'Draft');

    var right = h('div', { class: 'toolbar-right' },
      h('button', { class: 'btn', onClick: function () { save(true); } }, 'Save draft'),
      h('button', { class: 'btn btn-primary', onClick: function () { save(false); } }, 'Publish')
    );
    if (!cur.isNew) {
      right.appendChild(h('button', { class: 'btn btn-danger', onClick: del }, 'Delete'));
    }

    return h('div', { class: 'toolbar', id: 'toolbar' },
      h('div', { class: 'toolbar-left' },
        h('button', { class: 'btn btn-ghost', onClick: function () { location.hash = '#/c/' + cur.type; } }, '← Back'),
        h('span', { class: 'toolbar-title' }, title),
        statusPill
      ),
      right
    );
  }

  function refreshToolbar() {
    var old = document.getElementById('toolbar');
    if (old && state.current) old.replaceWith(buildToolbar());
  }

  function setToolbarBusy(busy) {
    var btns = document.querySelectorAll('.toolbar-right button');
    for (var i = 0; i < btns.length; i++) btns[i].disabled = busy;
  }

  // Build a single field control bound to `data`.
  function buildField(f, data) {
    if (f.type === 'media') return mediaField(f, data);
    if (f.type === 'string-list') return listField(f, data);

    var domId = 'f-' + f.key;

    if (f.type === 'checkbox') {
      var cb = h('input', { type: 'checkbox', id: domId });
      cb.checked = !!data[f.key];
      cb.addEventListener('change', function () { data[f.key] = cb.checked; updatePreview(); });
      return h('div', { class: 'field field-check' }, cb, h('label', { for: domId }, f.label));
    }

    var input;
    if (f.type === 'textarea') {
      input = h('textarea', { id: domId, rows: '3' });
      input.value = data[f.key] || '';
    } else if (f.type === 'select') {
      input = h('select', { id: domId });
      var chosen = data[f.key] != null ? data[f.key] : f.default;
      f.options.forEach(function (opt) {
        var o = h('option', { value: opt }, opt);
        if (opt === chosen) o.selected = true;
        input.appendChild(o);
      });
      if (data[f.key] == null) data[f.key] = chosen; // lock in the default
    } else if (f.type === 'number') {
      input = h('input', { type: 'number', id: domId });
      input.value = data[f.key] != null ? data[f.key] : '';
    } else {
      input = h('input', { type: f.type === 'date' ? 'date' : 'text', id: domId, placeholder: f.placeholder || '' });
      input.value = data[f.key] || '';
    }

    var evt = f.type === 'select' ? 'change' : 'input';
    input.addEventListener(evt, function () { data[f.key] = input.value; updatePreview(); });

    return h('div', { class: 'field' },
      h('label', { for: domId }, f.label + (f.required ? ' *' : '')),
      input
    );
  }

  // string-list (e.g. whatYouCanDo): rows of text inputs with add/remove.
  function listField(f, data) {
    var arr = Array.isArray(data[f.key]) ? data[f.key].slice() : [];
    var rows = h('div', { class: 'list-rows' });

    function sync() { data[f.key] = arr.slice(); updatePreview(); }
    function draw() {
      rows.innerHTML = '';
      arr.forEach(function (val, i) {
        var input = h('input', { type: 'text' });
        input.value = val;
        input.addEventListener('input', function () { arr[i] = input.value; sync(); });
        var rm = h('button', {
          class: 'btn btn-small', type: 'button', title: 'Remove',
          onClick: function () { arr.splice(i, 1); draw(); sync(); }
        }, '✕');
        rows.appendChild(h('div', { class: 'list-row' }, input, rm));
      });
    }
    draw();
    sync();

    return h('div', { class: 'field' },
      h('label', {}, f.label),
      rows,
      h('button', {
        class: 'btn btn-small', type: 'button',
        onClick: function () { arr.push(''); draw(); sync(); }
      }, 'Add')
    );
  }

  // media field: file input → downscale → upload → store URL + thumbnail.
  function mediaField(f, data) {
    var status = h('div', { class: 'media-status muted' });
    var preview = h('div', { class: 'media-preview' });
    var fileInput = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp' });

    function drawThumb() {
      preview.innerHTML = '';
      if (data[f.key]) {
        preview.appendChild(h('img', { class: 'thumb', src: data[f.key], alt: '' }));
        preview.appendChild(h('button', {
          class: 'btn btn-small', type: 'button',
          onClick: function () { data[f.key] = ''; drawThumb(); status.textContent = ''; updatePreview(); }
        }, 'Remove'));
      }
    }

    fileInput.addEventListener('change', function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;
      status.textContent = 'Processing and uploading…';
      fileInput.disabled = true;
      uploadImage(file, mediaPrefix(state.current.type)).then(function (url) {
        data[f.key] = url;
        status.textContent = 'Uploaded.';
        drawThumb();
        updatePreview();
      }).catch(function (err) {
        if (err.message !== 'unauthorized') status.textContent = err.message || 'Upload failed.';
      }).then(function () {
        fileInput.value = '';
        fileInput.disabled = false;
      });
    });

    drawThumb();
    return h('div', { class: 'field' },
      h('label', {}, f.label + (f.required ? ' *' : '')),
      fileInput,
      status,
      preview
    );
  }

  // Compact meta line for the preview, per collection.
  function previewMeta(type, d) {
    var out = [];
    if (type === 'events') {
      if (d.start) out.push(formatWhen(d.start) + (d.end ? ' – ' + formatWhen(d.end) : ''));
      if (d.time) out.push(d.time);
      if (d.location) out.push(d.location);
      if (d.example) out.push('Suggested');
    } else if (type === 'news') {
      if (d.date) out.push(formatWhen(d.date));
      if (d.category) out.push(d.category);
      if (d.author) out.push('by ' + d.author);
      if (d.pinned) out.push('Pinned');
    } else if (type === 'positions') {
      if (d.status) out.push(d.status);
      if (d.updated) out.push('Updated ' + formatWhen(d.updated));
    } else if (type === 'groups') {
      if (d.kind) out.push(d.kind);
      if (d.schedule) out.push(d.schedule);
      if (d.meetingPoint) out.push(d.meetingPoint);
    } else if (type === 'meetings') {
      if (d.date) out.push(formatWhen(d.date));
      if (d.kind) out.push(d.kind);
    } else if (type === 'gallery') {
      if (d.date) out.push(formatWhen(d.date));
      if (d.credit) out.push('Photo: ' + d.credit);
    }
    return out;
  }

  function updatePreview() {
    var box = document.querySelector('.preview-body');
    if (!box || !state.current) return;
    var cur = state.current;
    var d = cur.data;
    var title = d.title || d.name || (cur.type === 'gallery' ? (d.caption || 'Photo') : 'Untitled');

    var html = '<h1 class="pv-title">' + escapeHtml(title) + '</h1>';
    var meta = previewMeta(cur.type, d);
    if (meta.length) {
      html += '<div class="pv-meta">' + meta.map(function (m) { return '<span>' + escapeHtml(m) + '</span>'; }).join('') + '</div>';
    }
    if (d.image) {
      html += '<img class="pv-img" src="' + escapeHtml(d.image) + '" alt="' + escapeHtml(d.imageAlt || d.alt || '') + '">';
    }
    if (d.summary) html += '<p class="pv-summary">' + escapeHtml(d.summary) + '</p>';
    if (Array.isArray(d.whatYouCanDo) && d.whatYouCanDo.filter(Boolean).length) {
      html += '<h3>What you can do</h3><ul>' +
        d.whatYouCanDo.filter(Boolean).map(function (x) { return '<li>' + escapeHtml(x) + '</li>'; }).join('') +
        '</ul>';
    }
    if (cur.body && cur.body.trim()) html += '<div class="pv-body">' + renderMarkdown(cur.body) + '</div>';
    box.innerHTML = html;
  }

  // Turn form data into a clean payload; omit empty optionals, always emit draft.
  function cleanData(type, data, draft) {
    var out = {};
    FIELDS[type].forEach(function (f) {
      var v = data[f.key];
      if (f.type === 'checkbox') {
        out[f.key] = !!v;
      } else if (f.type === 'number') {
        if (v !== '' && v != null && !isNaN(Number(v))) out[f.key] = Number(v);
        else if (f.default != null) out[f.key] = f.default;
      } else if (f.type === 'string-list') {
        var arr = (Array.isArray(v) ? v : []).map(function (x) { return String(x).trim(); }).filter(Boolean);
        if (arr.length) out[f.key] = arr;
      } else {
        var s = (v == null ? '' : String(v)).trim();
        if (s) out[f.key] = s;
      }
    });
    out.draft = draft;
    return out;
  }

  function deriveSlug(coll, data) {
    var base = data[coll.titleKey] || data.title || data.name || data.caption || '';
    var s = slugify(base);
    if (!s && coll.type === 'gallery') s = 'photo-' + Math.random().toString(36).slice(2, 8);
    return s;
  }

  function save(draft) {
    var cur = state.current;
    var spec = FIELDS[cur.type];

    var missing = spec.filter(function (f) { return f.required && isEmpty(cur.data[f.key]); });
    if (missing.length) {
      toast('Please fill in: ' + missing.map(function (f) { return f.label; }).join(', '), 'error');
      return;
    }

    var id = cur.id;
    if (cur.isNew) {
      id = deriveSlug(cur.coll, cur.data);
      if (!id) { toast('Add a ' + cur.coll.titleKey + ' first so we can name the file.', 'error'); return; }
    }

    var payload = { data: cleanData(cur.type, cur.data, draft), body: cur.body };
    if (cur.sha) payload.sha = cur.sha;

    setToolbarBusy(true);
    apiFetch('/cms/item/' + cur.type + '/' + encodeURIComponent(id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) { throw new Error('Save failed: ' + (t || res.status)); });
      }
      return res.json();
    }).then(function (j) {
      cur.id = id;
      cur.isNew = false;
      cur.sha = j.sha || cur.sha;
      cur.data.draft = draft;
      // Reflect the real edit URL without a reload (keeps the form as-is).
      history.replaceState(null, '', '#/edit/' + cur.type + '/' + encodeURIComponent(id));
      refreshToolbar();
      toast(draft ? 'Saved as a draft.' : 'Published — it will be live in a minute or two.', 'success');
    }).catch(function (err) {
      if (err.message !== 'unauthorized') toast(err.message || 'Save failed.', 'error');
    }).then(function () {
      setToolbarBusy(false);
    });
  }

  function del() {
    var cur = state.current;
    if (!cur.sha) return;
    if (!window.confirm('Delete this ' + cur.coll.singular + '? This cannot be undone.')) return;
    setToolbarBusy(true);
    apiFetch('/cms/item/' + cur.type + '/' + encodeURIComponent(cur.id), {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sha: cur.sha })
    }).then(function (res) {
      if (!res.ok) throw new Error('Delete failed (' + res.status + ').');
      toast('Deleted.', 'success');
      location.hash = '#/c/' + cur.type;
    }).catch(function (err) {
      if (err.message !== 'unauthorized') toast(err.message || 'Delete failed.', 'error');
      setToolbarBusy(false);
    });
  }

  // ---------------------------------------------------------------------------
  // View: moderation (pending photo submissions)
  // ---------------------------------------------------------------------------
  function viewModeration(main) {
    main.appendChild(h('div', { class: 'view-head' }, h('h1', {}, 'Photo submissions')));
    var grid = h('div', { class: 'mod-grid' }, h('div', { class: 'muted' }, 'Loading…'));
    main.appendChild(grid);

    return apiFetch('/cms/moderation').then(function (res) {
      if (!res.ok) throw new Error('Could not load submissions.');
      return res.json();
    }).then(function (data) {
      var items = (data && data.items) || [];
      grid.innerHTML = '';
      if (!items.length) {
        grid.appendChild(h('div', { class: 'empty' }, 'No photos are waiting for review.'));
        return;
      }
      items.forEach(function (it) { grid.appendChild(modCard(it, grid)); });
    }).catch(function (err) {
      if (err.message === 'unauthorized') return;
      grid.innerHTML = '';
      grid.appendChild(errorBox(err));
    });
  }

  function modField(label, input) {
    return h('div', { class: 'mod-field' }, h('label', {}, label), input);
  }

  function modCard(it, grid) {
    var caption = h('input', { type: 'text', placeholder: 'Caption' });
    caption.value = it.caption || '';
    var credit = h('input', { type: 'text', placeholder: 'Credit' });
    credit.value = it.credit || it.submitterName || '';
    var alt = h('input', { type: 'text', placeholder: 'Describe the photo' });
    var date = h('input', { type: 'date' });
    date.value = it.submittedAt ? String(it.submittedAt).slice(0, 10) : todayISO();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date.value)) date.value = todayISO();

    var who = [it.submitterName, it.submitterEmail].filter(Boolean).join(' · ');

    var approve = h('button', { class: 'btn btn-primary' }, 'Approve');
    var reject = h('button', { class: 'btn btn-danger' }, 'Reject');

    var card = h('div', { class: 'mod-card' },
      h('img', { class: 'mod-thumb', src: it.thumbUrl, alt: it.caption || '', loading: 'lazy' }),
      h('div', { class: 'mod-body' },
        h('div', { class: 'mod-who' }, who || 'Anonymous'),
        it.submittedAt ? h('div', { class: 'muted mod-when' }, 'Submitted ' + formatWhen(it.submittedAt)) : null,
        modField('Caption', caption),
        modField('Credit', credit),
        modField('Alt text', alt),
        modField('Date', date),
        h('div', { class: 'mod-actions' }, approve, reject)
      )
    );

    function busy(b) { approve.disabled = b; reject.disabled = b; }

    approve.addEventListener('click', function () {
      busy(true);
      apiFetch('/cms/moderation/' + encodeURIComponent(it.id) + '/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caption: caption.value.trim(),
          credit: credit.value.trim(),
          alt: alt.value.trim(),
          date: date.value
        })
      }).then(function (res) {
        if (!res.ok) throw new Error('Approve failed (' + res.status + ').');
        card.remove();
        checkEmpty(grid);
        toast('Added to the gallery.', 'success');
      }).catch(function (err) {
        if (err.message !== 'unauthorized') { busy(false); toast(err.message || 'Approve failed.', 'error'); }
      });
    });

    reject.addEventListener('click', function () {
      if (!window.confirm('Reject and delete this submission?')) return;
      busy(true);
      apiFetch('/cms/moderation/' + encodeURIComponent(it.id) + '/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      }).then(function (res) {
        if (!res.ok) throw new Error('Reject failed (' + res.status + ').');
        card.remove();
        checkEmpty(grid);
        toast('Submission rejected.', 'info');
      }).catch(function (err) {
        if (err.message !== 'unauthorized') { busy(false); toast(err.message || 'Reject failed.', 'error'); }
      });
    });

    return card;
  }

  function checkEmpty(grid) {
    if (!grid.querySelector('.mod-card')) {
      grid.innerHTML = '';
      grid.appendChild(h('div', { class: 'empty' }, 'No photos are waiting for review.'));
    }
  }

  // ---------------------------------------------------------------------------
  // Toast + overlays
  // ---------------------------------------------------------------------------
  function toast(message, kind) {
    var wrap = document.querySelector('.toast-wrap');
    if (!wrap) { wrap = h('div', { class: 'toast-wrap' }); document.body.appendChild(wrap); }
    var el = h('div', { class: 'toast toast-' + (kind || 'info') }, message);
    wrap.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 4200);
  }

  function showSessionExpired() {
    if (state.sessionDead) return;
    state.sessionDead = true;
    document.body.appendChild(h('div', { class: 'overlay' },
      h('div', { class: 'center-card' },
        h('h1', {}, 'Session expired'),
        h('p', {}, 'Your Cloudflare Access session has ended. Reload to sign in again — any unsaved changes will be lost.'),
        h('button', { class: 'btn btn-primary', onClick: function () { location.reload(); } }, 'Reload')
      )
    ));
  }

  function renderSignInRequired() {
    var app = document.getElementById('app');
    app.innerHTML = '';
    app.appendChild(h('div', { class: 'center-card' },
      h('h1', {}, 'Not signed in'),
      h('p', {}, 'This editor is protected by Cloudflare Access. Open it through the Access sign-in link (you will get a one-time email code), then reload this page.'),
      h('button', { class: 'btn btn-primary', onClick: function () { location.reload(); } }, 'Reload')
    ));
  }

  function renderFatal(message) {
    var app = document.getElementById('app');
    app.innerHTML = '';
    app.appendChild(h('div', { class: 'center-card' },
      h('h1', {}, 'Can’t reach the editor'),
      h('p', {}, message),
      h('button', { class: 'btn btn-primary', onClick: function () { location.reload(); } }, 'Reload')
    ));
  }

  // ---------------------------------------------------------------------------
  // Router + boot
  // ---------------------------------------------------------------------------
  function collFor(type) {
    for (var i = 0; i < COLLECTIONS.length; i++) if (COLLECTIONS[i].type === type) return COLLECTIONS[i];
    return null;
  }

  function renderRoute(main) {
    var hash = location.hash || '#/c/events';
    var raw = hash.replace(/^#\/?/, '').split('/');
    var parts = raw.map(function (p) { try { return decodeURIComponent(p); } catch (e) { return p; } });

    if (parts[0] === 'c') return void viewCollectionList(main, parts[1]);
    if (parts[0] === 'new') return void viewEdit(main, parts[1], null);
    if (parts[0] === 'edit') return void viewEdit(main, parts[1], parts[2]);
    if (parts[0] === 'moderation') return void viewModeration(main);
    return void viewCollectionList(main, 'events');
  }

  function boot() {
    fetch('/cms/me').then(function (res) {
      if (res.status === 401) { renderSignInRequired(); return null; }
      if (!res.ok) { renderFatal('The CMS returned an unexpected error (' + res.status + '). Try again shortly.'); return null; }
      return res.json();
    }).then(function (data) {
      if (!data) return;
      state.email = (data && data.email) || '';
      window.addEventListener('hashchange', render);
      if (!location.hash) location.hash = '#/c/events';
      render();
    }).catch(function () {
      renderFatal('Please check your connection and reload.');
    });
  }

  boot();
})();
