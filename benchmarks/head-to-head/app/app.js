(function () {
    // --- 1. Bidirectional IPC Setup (200ms Active Exchange) ---
    let ipcCount = 0;
    const ipcCountEl = document.getElementById('ipc-count');

    function sendIpcMessage(channel, payload) {
        if (window.electronAPI && typeof window.electronAPI.send === 'function') {
            window.electronAPI.send(channel, payload);
        } else if (window.adrenaline && typeof window.adrenaline.send === 'function') {
            window.adrenaline.send(channel, payload);
        } else if (window.__adrenaline_ipc_send) {
            window.__adrenaline_ipc_send(channel, payload);
        }
    }

    function onIpcMessage(channel, callback) {
        if (window.electronAPI && typeof window.electronAPI.on === 'function') {
            window.electronAPI.on(channel, callback);
        } else if (window.adrenaline && typeof window.adrenaline.on === 'function') {
            window.adrenaline.on(channel, callback);
        }
    }

    onIpcMessage('ping-from-main', function (data) {
        ipcCount++;
        if (ipcCountEl) ipcCountEl.textContent = ipcCount.toLocaleString();

        // Mutate dynamic dataset value on incoming background payload
        if (data && data.seq && records.length > 0) {
            const idx = (data.seq * 17) % records.length;
            records[idx].value = (Math.random() * 5000 + 1000).toFixed(2);
        }

        sendIpcMessage('pong-from-renderer', {
            receivedSeq: data ? data.seq : 0,
            timestamp: Date.now(),
            activeRows: records.length
        });
    });

    // Notify runner that interactive paint is ready
    requestAnimationFrame(function () {
        setTimeout(function () {
            sendIpcMessage('app-ready', { time: Date.now() });
        }, 50);
    });


    // --- 2. Realistic Productivity Workload (1,000+ Dynamic Records) ---
    const tableBody = document.getElementById('table-body');
    const recordCountEl = document.getElementById('record-count');
    const renderTimeEl = document.getElementById('render-time');
    const searchInput = document.getElementById('search-input');

    const firstNames = ['Alex', 'Sam', 'Taylor', 'Jordan', 'Morgan', 'Casey', 'Riley', 'Jamie', 'Avery', 'Dakota', 'Elena', 'Marcus', 'Sophia', 'Lucas'];
    const lastNames = ['Smith', 'Johnson', 'Williams', 'Jones', 'Brown', 'Davis', 'Miller', 'Wilson', 'Moore', 'Taylor', 'Anderson', 'Thomas', 'Jackson'];
    const roles = ['Software Engineer', 'Product Manager', 'UX Designer', 'Data Scientist', 'DevOps Lead', 'QA Analyst', 'Security Engineer', 'Architect'];
    const departments = ['Engineering', 'Product', 'Design', 'Analytics', 'Operations', 'Security', 'Infrastructure'];
    const statuses = ['Active', 'Pending', 'Offline', 'Busy'];

    const records = [];
    for (let i = 1; i <= 1000; i++) {
        const fn = firstNames[i % firstNames.length];
        const ln = lastNames[(i * 3) % lastNames.length];
        records.push({
            id: i,
            name: fn + ' ' + ln,
            role: roles[i % roles.length],
            department: departments[i % departments.length],
            status: statuses[i % statuses.length],
            value: (Math.sin(i) * 2000 + 3000).toFixed(2)
        });
    }

    let currentFilter = '';
    let sortKey = null;
    let sortAsc = true;

    function renderTable() {
        const t0 = performance.now();
        const term = currentFilter.toLowerCase();

        let filtered = records.filter(function (r) {
            if (!term) return true;
            return r.name.toLowerCase().includes(term) ||
                   r.role.toLowerCase().includes(term) ||
                   r.department.toLowerCase().includes(term) ||
                   r.status.toLowerCase().includes(term);
        });

        if (sortKey) {
            filtered.sort(function (a, b) {
                let valA = a[sortKey];
                let valB = b[sortKey];
                if (sortKey === 'value' || sortKey === 'id') {
                    valA = parseFloat(valA);
                    valB = parseFloat(valB);
                }
                if (valA < valB) return sortAsc ? -1 : 1;
                if (valA > valB) return sortAsc ? 1 : -1;
                return 0;
            });
        }

        let html = '';
        for (let i = 0; i < filtered.length; i++) {
            const r = filtered[i];
            const badgeClass = 'badge badge-' + r.status.toLowerCase();
            html += '<tr>' +
                '<td>#' + r.id + '</td>' +
                '<td><strong>' + r.name + '</strong></td>' +
                '<td>' + r.role + '</td>' +
                '<td>' + r.department + '</td>' +
                '<td><span class="' + badgeClass + '">' + r.status + '</span></td>' +
                '<td>$' + Number(r.value).toLocaleString(undefined, { minimumFractionDigits: 2 }) + '</td>' +
            '</tr>';
        }
        tableBody.innerHTML = html;

        const renderMs = (performance.now() - t0).toFixed(1);
        if (recordCountEl) recordCountEl.textContent = filtered.length.toLocaleString();
        if (renderTimeEl) renderTimeEl.textContent = renderMs + 'ms';
    }

    renderTable();

    // Event handlers for productivity UI interaction
    if (searchInput) {
        searchInput.addEventListener('input', function (e) {
            currentFilter = e.target.value;
            renderTable();
        });
    }

    document.getElementById('btn-sort-name').addEventListener('click', function () {
        if (sortKey === 'name') sortAsc = !sortAsc;
        else { sortKey = 'name'; sortAsc = true; }
        renderTable();
    });

    document.getElementById('btn-sort-value').addEventListener('click', function () {
        if (sortKey === 'value') sortAsc = !sortAsc;
        else { sortKey = 'value'; sortAsc = false; }
        renderTable();
    });

    document.getElementById('btn-shuffle').addEventListener('click', function () {
        records.sort(() => Math.random() - 0.5);
        renderTable();
    });

    // Auto simulated user filter typing activity every 1.5s
    const queryTerms = ['', 'Software', 'Engineer', 'Product', 'Active', 'Data', 'Alex', 'Security', ''];
    let termIdx = 0;
    setInterval(function () {
        termIdx = (termIdx + 1) % queryTerms.length;
        currentFilter = queryTerms[termIdx];
        if (searchInput) searchInput.value = currentFilter;
        renderTable();
    }, 1500);
})();
