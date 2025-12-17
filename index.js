
        // --- 1. SUPABASE CONFIGURATION ---
        const SUPABASE_URL = 'https://gscsuzovbuvckkwukiky.supabase.co';
        const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdzY3N1em92YnV2Y2trd3VraWt5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQwNzcwMjQsImV4cCI6MjA3OTY1MzAyNH0.SyYeUFXJ0MKx_2d5EWoM3W4pqQUomWeqxOsfSwApdz4';
        const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

        // --- 2. GLOBAL STATE ---
        let currentStorageTabId = null;
        let currentStorageName = "";
        let currentStorageBalance = 0;
        let chartInstance = null;
        let activeFilter = { type: 'currentMonth' };
        let storageMap = {};
        let summaryStats = { mIn: 0, mOut: 0, yIn: 0, yOut: 0 };

        // Dashboard Carousel State
        let currentSlide = 0;
        let cachedStorageBalances = {};

        // Sidebar Navigation Carousel State
        let currentNavSlide = 0;
        let navStorageItems = [];

        // --- 3. UI HELPERS & THEME ---
        const Toast = Swal.mixin({
            toast: true,
            position: 'top-end',
            showConfirmButton: false,
            timer: 3000,
            timerProgressBar: true
        });

        if (localStorage.getItem('theme') === 'dark') {
            document.body.classList.add('dark-mode');
            document.getElementById('theme-icon').classList.replace('ph-moon', 'ph-sun');
        }

        function toggleTheme() {
            document.body.classList.toggle('dark-mode');
            const icon = document.getElementById('theme-icon');
            if (document.body.classList.contains('dark-mode')) {
                icon.classList.replace('ph-moon', 'ph-sun');
                localStorage.setItem('theme', 'dark');
            } else {
                icon.classList.replace('ph-sun', 'ph-moon');
                localStorage.setItem('theme', 'light');
            }
            if (chartInstance) updateChartColors();
        }

        // Toggle Sidebar Function
        function toggleSidebar() {
            document.getElementById('sidebar').classList.toggle('is-active');
            document.querySelector('.burger-menu').classList.toggle('is-active');
        }

        // Toggle Buttons Logic (Radio Replacement)
        function setTrxType(type) {
            document.getElementById('trx-type-input').value = type;
            const btnIn = document.getElementById('btn-in');
            const btnOut = document.getElementById('btn-out');

            // Reset
            btnIn.classList.remove('is-selected-success');
            btnOut.classList.remove('is-selected-danger');
            btnIn.classList.remove('is-selected');
            btnOut.classList.remove('is-selected');

            if (type === 'Pemasukan') {
                btnIn.classList.add('is-selected-success');
            } else {
                btnOut.classList.add('is-selected-danger');
            }
        }

        // --- 4. NAVIGATION & INIT ---
        function navigate(page) {
            document.querySelectorAll('[id^="page-"]').forEach(el => el.classList.add('is-hidden'));
            document.querySelectorAll('.menu-list a').forEach(el => el.classList.remove('is-active'));
            document.getElementById(`page-${page}`).classList.remove('is-hidden');
            document.getElementById(`nav-${page}`).classList.add('is-active');

            // Auto close sidebar on mobile when link is clicked
            if (window.innerWidth < 1024) {
                document.getElementById('sidebar').classList.remove('is-active');
                document.querySelector('.burger-menu').classList.remove('is-active');
            }

            if (page === 'dashboard') loadDashboard();
            if (page === 'catatan') loadCatatan();
            if (page === 'penyimpanan') loadPenyimpanan();
            if (page === 'transfer') loadTransfer();
        }

        window.addEventListener('DOMContentLoaded', () => {
            const today = new Date().toISOString().split('T')[0];
            document.getElementById('trx-date').value = today;
            document.getElementById('trf-date').value = today;
            loadDashboard();
            
            // Resize listener for Carousel responsiveness
            window.addEventListener('resize', () => {
                if(!document.getElementById('page-dashboard').classList.contains('is-hidden')) {
                    initDashboardCarousel();
                }
            });
        });

        // --- 5. DATA FORMATTING & UTILS ---
        function formatRupiah(number) {
            return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(number);
        }

        function unformatRupiah(str) {
            return parseInt(str.replace(/[^0-9]/g, '')) || 0;
        }

        function formatCurrencyInput(input) {
            let val = input.value.replace(/[^0-9]/g, '');
            if (val === '') { input.value = ''; return; }
            input.value = new Intl.NumberFormat('id-ID').format(val);
        }

        function formatDate(dateStr) {
            const options = { day: 'numeric', month: 'long', year: 'numeric' };
            return new Date(dateStr).toLocaleDateString('id-ID', options);
        }

        // Helper to get strictly formatted YYYY-MM-DD strings for filters
        function getMonthDateRange(year, month) {
            // Month is 1-12
            const startStr = `${year}-${String(month).padStart(2, '0')}-01`;
            const lastDay = new Date(year, month, 0).getDate();
            const endStr = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;
            return { start: startStr, end: endStr };
        }

        function getCurrentMonthRange() {
            const now = new Date();
            return getMonthDateRange(now.getFullYear(), now.getMonth() + 1);
        }

        function getYearRange(year) {
            return { start: `${year}-01-01`, end: `${year}-12-31` };
        }

        // --- CALCULATE GLOBAL STATS ---
        async function calculateSummaryStats(filterStorageId = null) {
            const now = new Date();
            const mRange = getCurrentMonthRange();
            const yRange = getYearRange(now.getFullYear());

            let qMonth = supabaseClient.from('keuangan').select('saldo, transaksi').gte('tanggal', mRange.start).lte('tanggal', mRange.end);
            let qYear = supabaseClient.from('keuangan').select('saldo, transaksi').gte('tanggal', yRange.start).lte('tanggal', yRange.end);

            if (filterStorageId) {
                qMonth = qMonth.eq('id_sim', filterStorageId);
                qYear = qYear.eq('id_sim', filterStorageId);
            }

            const resMonth = await qMonth;
            const resYear = await qYear;

            let mIn = 0, mOut = 0, yIn = 0, yOut = 0;

            if (resMonth.data) {
                resMonth.data.forEach(t => {
                    if (t.transaksi === 'Pemasukan') mIn += t.saldo;
                    else if (t.transaksi === 'Pengeluaran') mOut += t.saldo; 
                });
            }
            if (resYear.data) {
                resYear.data.forEach(t => {
                    if (t.transaksi === 'Pemasukan') yIn += t.saldo;
                    else if (t.transaksi === 'Pengeluaran') yOut += t.saldo; 
                });
            }

            summaryStats = { mIn, mOut, yIn, yOut };
            return summaryStats;
        }

        function renderSummaryText(containerId, stats) {
            const el = document.getElementById(containerId);
            el.innerHTML = `
                <div class="columns is-mobile is-multiline">
                    <div class="column is-6">
                        <p class="has-text-grey-light is-size-12">Bulan Ini</p>
                        <p class="has-text-success-custom is-size-12 font-weight-bold">Masuk: ${formatRupiah(stats.mIn)}</p>
                        <p class="has-text-danger-custom is-size-12 font-weight-bold">Keluar: ${formatRupiah(stats.mOut)}</p>
                    </div>
                    <div class="column is-6">
                        <p class="has-text-grey-light is-size-12">Tahun Ini</p>
                        <p class="has-text-success-custom is-size-12 font-weight-bold">Masuk: ${formatRupiah(stats.yIn)}</p>
                        <p class="has-text-danger-custom is-size-12 font-weight-bold">Keluar: ${formatRupiah(stats.yOut)}</p>
                    </div>
                </div>
            `;
        }

        // --- 6. PAGE LOGIC: DASHBOARD & CAROUSEL ---
        async function loadDashboard() {
            const range = getCurrentMonthRange();

            const { data: trxData, error } = await supabaseClient
                .from('keuangan')
                .select('*')
                .gte('tanggal', range.start)
                .lte('tanggal', range.end);

            if (error) { console.error(error); return; }

            let income = 0;
            let expense = 0;
            const now = new Date();
            const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
            const chartLabels = Array.from({ length: daysInMonth }, (_, i) => i + 1);
            const chartDataIncome = new Array(daysInMonth).fill(0);
            const chartDataExpense = new Array(daysInMonth).fill(0);

            trxData.forEach(trx => {
                const day = new Date(trx.tanggal).getDate();
                if (day >= 1 && day <= daysInMonth) {
                    if (trx.transaksi === 'Pemasukan') {
                        income += trx.saldo;
                        chartDataIncome[day - 1] += trx.saldo;
                    } else if (trx.transaksi === 'Pengeluaran') {
                        expense += trx.saldo;
                        chartDataExpense[day - 1] += trx.saldo;
                    }
                }
            });

            document.getElementById('dash-pemasukan').innerText = formatRupiah(income);
            document.getElementById('dash-pengeluaran').innerText = formatRupiah(expense);

            const { data: storeData } = await supabaseClient.from('penyimpanan').select('*');
            const { data: allTrx } = await supabaseClient.from('keuangan').select('id_sim, saldo, transaksi');

            let grandTotal = 0;
            cachedStorageBalances = {}; // Reset global cache
            storeData.forEach(s => cachedStorageBalances[s.id_sim] = { name: s.namasim, balance: 0 });

            if (allTrx) {
                allTrx.forEach(t => {
                    if (cachedStorageBalances[t.id_sim]) {
                        if (t.transaksi === 'Pemasukan') cachedStorageBalances[t.id_sim].balance += t.saldo;
                        else cachedStorageBalances[t.id_sim].balance -= t.saldo;
                    }
                });
            }

            for (const [id, store] of Object.entries(cachedStorageBalances)) {
                grandTotal += store.balance;
            }

            document.getElementById('dash-total-uang').innerText = formatRupiah(grandTotal);
            renderChart(chartLabels, chartDataIncome, chartDataExpense);
            
            // Initialize Carousel with Data
            initDashboardCarousel();
        }

        // --- CAROUSEL LOGIC ---
        function initDashboardCarousel() {
            const track = document.getElementById('dash-storage-track');
            const dotsContainer = document.getElementById('carousel-dots');
            const width = window.innerWidth;
            
            let itemsPerSlide = 8;
            if (width < 769) itemsPerSlide = 4;
            else if (width < 1024) itemsPerSlide = 6;

            const storageIds = Object.keys(cachedStorageBalances);
            const totalItems = storageIds.length;
            const totalSlides = Math.ceil(totalItems / itemsPerSlide);

            let slidesHTML = '';
            for (let i = 0; i < totalSlides; i++) {
                let chunk = storageIds.slice(i * itemsPerSlide, (i + 1) * itemsPerSlide);
                
                let gridHTML = `<div class="columns is-multiline is-mobile mt-1">`;
                
                chunk.forEach(id => {
                    const store = cachedStorageBalances[id];
                    gridHTML += `
                        <div class="column is-3-desktop is-6-tablet is-12-mobile">
                            <div class="card p-3 h-100" style="height: 100%;">
                                <p class="is-size-7 has-text-grey-light">Penyimpanan</p>
                                <p class="has-text-weight-bold is-size-5 mb-1 is-truncated">${store.name}</p>
                                <p class="has-text-info font-weight-bold">${formatRupiah(store.balance)}</p>
                            </div>
                        </div>
                    `;
                });
                
                gridHTML += `</div>`;
                slidesHTML += `<div class="carousel-slide">${gridHTML}</div>`;
            }

            track.innerHTML = slidesHTML;
            
            let dotsHTML = '';
            for(let i=0; i<totalSlides; i++) {
                dotsHTML += `<div class="dot ${i===0?'is-active':''}" onclick="goToSlide(${i})"></div>`;
            }
            dotsContainer.innerHTML = dotsHTML;

            currentSlide = 0;
            updateCarouselView();
            updateCarouselControls(totalSlides);
        }

        function updateCarouselView() {
            const track = document.getElementById('dash-storage-track');
            track.style.transform = `translateX(-${currentSlide * 100}%)`;
            
            const dots = document.querySelectorAll('#carousel-dots .dot');
            dots.forEach((d, index) => {
                if(index === currentSlide) d.classList.add('is-active');
                else d.classList.remove('is-active');
            });
        }

        function nextSlide() {
            const track = document.getElementById('dash-storage-track');
            const totalSlides = track.children.length;
            if (currentSlide < totalSlides - 1) {
                currentSlide++;
                updateCarouselView();
                updateCarouselControls(totalSlides);
            }
        }

        function prevSlide() {
            if (currentSlide > 0) {
                currentSlide--;
                updateCarouselView();
                updateCarouselControls(document.getElementById('dash-storage-track').children.length);
            }
        }

        function goToSlide(index) {
            currentSlide = index;
            updateCarouselView();
            updateCarouselControls(document.getElementById('dash-storage-track').children.length);
        }

        function updateCarouselControls(total) {
            const prevBtn = document.getElementById('dash-prev-btn');
            const nextBtn = document.getElementById('dash-next-btn');
            
            if (prevBtn) prevBtn.disabled = currentSlide === 0;
            if (nextBtn) nextBtn.disabled = currentSlide === total - 1;
            
            // Optional: Hide buttons if only 1 slide exists
            if(total <= 1) {
               if(prevBtn) prevBtn.parentElement.style.display = 'none';
            } else {
               if(prevBtn) prevBtn.parentElement.style.display = 'grid';
            }
        }

        // --- CHART & COLORS ---
        function renderChart(labels, incomeData, expenseData) {
            const ctx = document.getElementById('financeChart').getContext('2d');
            if (chartInstance) chartInstance.destroy();

            const isDark = document.body.classList.contains('dark-mode');
            const gridColor = isDark ? '#1e3a5f' : '#f0f0f0';
            const textColor = isDark ? '#d0efff' : '#666';

            chartInstance = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [
                        {
                            label: 'Pemasukan',
                            data: incomeData,
                            borderColor: '#2ecc71',
                            backgroundColor: 'rgba(46, 204, 113, 0.1)',
                            borderWidth: 2,
                            tension: 0.4,
                            fill: true
                        },
                        {
                            label: 'Pengeluaran',
                            data: expenseData,
                            borderColor: '#e74c3c',
                            backgroundColor: 'rgba(231, 76, 60, 0.1)',
                            borderWidth: 2,
                            tension: 0.4,
                            fill: true
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: {
                            beginAtZero: true,
                            suggestedMax: 100000,
                            grid: { color: gridColor },
                            ticks: { color: textColor }
                        },
                        x: {
                            grid: { color: gridColor },
                            ticks: { color: textColor }
                        }
                    },
                    plugins: {
                        legend: { labels: { color: textColor } }
                    }
                }
            });
        }

        function updateChartColors() {
            if (document.getElementById('page-dashboard').classList.contains('is-hidden')) return;
            loadDashboard();
        }

        // --- 7. PAGE LOGIC: CATATAN (TRANSACTIONS) ---
        async function loadCatatan() {
            const { data: stores } = await supabaseClient.from('penyimpanan').select('*');
            storageMap = {};
            const select = document.getElementById('trx-storage');
            select.innerHTML = '<option value="" disabled selected>Pilih Penyimpanan</option>';
            if (stores) {
                stores.forEach(s => {
                    storageMap[s.id_sim] = s.namasim;
                    select.innerHTML += `<option value="${s.id_sim}">${s.namasim}</option>`;
                });
            }
            activeFilter = { type: 'currentMonth' };
            document.getElementById('table-period-label').innerText = "Data Bulan Ini";
            fetchTransactions();
        }

        async function fetchTransactions() {
            const stats = await calculateSummaryStats(null);
            renderSummaryText('summary-stats-catatan', stats);

            let query = supabaseClient.from('keuangan').select('*');

            if (activeFilter.type === 'currentMonth') {
                const range = getCurrentMonthRange();
                query = query.gte('tanggal', range.start).lte('tanggal', range.end);
            } else if (activeFilter.type === 'range') {
                query = query.gte('tanggal', activeFilter.start).lte('tanggal', activeFilter.end);
            } else if (activeFilter.type === 'monthly') {
                const range = getMonthDateRange(activeFilter.year, activeFilter.month);
                query = query.gte('tanggal', range.start).lte('tanggal', range.end);
            } else if (activeFilter.type === 'yearly') {
                const range = getYearRange(activeFilter.year);
                query = query.gte('tanggal', range.start).lte('tanggal', range.end);
            }

            const { data, error } = await query.order('tanggal', { ascending: false });

            if (error) { Toast.fire({ icon: 'error', title: 'Gagal memuat data' }); return; }

            const tbody = document.getElementById('tbody-keuangan');
            tbody.innerHTML = '';

            if (data && data.length > 0) {
                data.forEach(row => {
                    let badgeClass = '';
                    let textClass = '';
                    let trxLabel = row.transaksi;

                    if (row.transaksi === 'Pemasukan') {
                        badgeClass = 'is-success';
                        textClass = 'has-text-success-custom';
                    } else if (row.transaksi === 'Pengeluaran') {
                        badgeClass = 'is-danger';
                        textClass = 'has-text-danger-custom';
                    } else if (row.transaksi === 'Transfer') {
                        badgeClass = 'is-info'; 
                        textClass = 'has-text-info-custom'; 
                    }
                    
                    const storageName = storageMap[row.id_sim] || 'Tidak Diketahui';

                    tbody.innerHTML += `
                        <tr>
                            <td data-date="${row.tanggal}">${formatDate(row.tanggal)}</td>
                            <td>${storageName}</td>
                            <td><span class="tag ${badgeClass} is-light">${trxLabel}</span></td>
                            <td class="col-desc">${row.deskripsi}</td>
                            <td class="has-text-right font-weight-bold ${textClass}">${formatRupiah(row.saldo)}</td>
                        </tr>
                    `;
                });
            } else {
                tbody.innerHTML = '<tr><td colspan="5" class="has-text-centered has-text-grey">Belum ada data untuk periode ini</td></tr>';
            }
        }

        async function handleTransactionSubmit(e) {
            e.preventDefault();
            const date = document.getElementById('trx-date').value;
            const storageId = document.getElementById('trx-storage').value;
            const type = document.getElementById('trx-type-input').value;
            const amount = unformatRupiah(document.getElementById('trx-amount').value);
            const desc = document.getElementById('trx-desc').value;

            if (!amount || amount <= 0) return Toast.fire({ icon: 'warning', title: 'Nominal tidak valid' });

            const { error } = await supabaseClient.from('keuangan').insert([{
                id_sim: storageId,
                tanggal: date,
                transaksi: type,
                saldo: amount,
                deskripsi: desc
            }]);

            if (error) {
                Toast.fire({ icon: 'error', title: error.message });
            } else {
                Toast.fire({ icon: 'success', title: 'Data Berhasil Ditambah' });
                resetForm('form-transaksi');
                fetchTransactions();
            }
        }

        function resetForm(formId) {
            document.getElementById(formId).reset();
            const today = new Date().toISOString().split('T')[0];
            if (formId === 'form-transaksi') {
                document.getElementById('trx-date').value = today;
                setTrxType('Pemasukan');
            }
            if (formId === 'form-transfer') document.getElementById('trf-date').value = today;
        }

        async function deleteLastTransaction() {
            const { data, error } = await supabaseClient.from('keuangan').select('id_keung').order('id_keung', { ascending: false }).limit(1);
            if (data && data.length > 0) {
                const idToDelete = data[0].id_keung;
                const { error: delError } = await supabaseClient.from('keuangan').delete().eq('id_keung', idToDelete);
                if (!delError) {
                    Toast.fire({ icon: 'success', title: 'Baris Terakhir Dihapus' });
                    fetchTransactions();
                }
            } else {
                Toast.fire({ icon: 'info', title: 'Data kosong' });
            }
        }

        function deleteAllData() {
            Swal.fire({
                title: 'Hapus Semua Data?',
                text: "Semua data keuangan akan hilang permanen!",
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#e74c3c',
                confirmButtonText: 'Ya, Hapus Semua!'
            }).then((result) => {
                if (result.isConfirmed) {
                    Swal.fire({
                        title: 'Yakin 100%?',
                        text: "Tindakan ini tidak bisa dibatalkan.",
                        icon: 'error',
                        showCancelButton: true,
                        confirmButtonText: 'HANCURKAN DATA'
                    }).then(async (res2) => {
                        if (res2.isConfirmed) {
                            const { error } = await supabaseClient.from('keuangan').delete().neq('id_keung', 0);
                            if (!error) {
                                Toast.fire({ icon: 'success', title: 'Semua Data Terhapus' });
                                fetchTransactions();
                            } else {
                                Toast.fire({ icon: 'error', title: 'Gagal Menghapus' });
                            }
                        }
                    });
                }
            });
        }

        // --- 8. FILTERS & MODALS ---
        function openModal(id) { document.getElementById(id).classList.add('is-active'); }
        function closeModal(id) { document.getElementById(id).classList.remove('is-active'); }

        function applyFilter(type) {
            if (type === 'range') {
                const start = document.getElementById('filter-start').value;
                const end = document.getElementById('filter-end').value;
                if (!start || !end) return Toast.fire({ icon: 'warning', title: 'Isi kedua tanggal' });
                activeFilter = { type: 'range', start, end };
                document.getElementById('table-period-label').innerText = `Rentang: ${start} s/d ${end}`;
                closeModal('modal-range');
            } else if (type === 'monthly') {
                const m = document.getElementById('filter-month-select').value;
                const y = document.getElementById('filter-month-year').value;
                if (!y) return Toast.fire({ icon: 'warning', title: 'Isi tahun' });
                activeFilter = { type: 'monthly', month: m, year: y };
                document.getElementById('table-period-label').innerText = `Periode: Bulan ${m}, ${y}`;
                closeModal('modal-monthly');
            } else if (type === 'yearly') {
                const y = document.getElementById('filter-year-input').value;
                if (!y) return Toast.fire({ icon: 'warning', title: 'Isi tahun' });
                activeFilter = { type: 'yearly', year: y };
                document.getElementById('table-period-label').innerText = `Periode: Tahun ${y}`;
                closeModal('modal-yearly');
            }

            if (!document.getElementById('page-catatan').classList.contains('is-hidden')) fetchTransactions();
            if (currentStorageTabId) fetchDetailStorage(currentStorageTabId);
        }

        // --- 9. PAGE LOGIC: PENYIMPANAN ---
        async function loadPenyimpanan() {
            const { data } = await supabaseClient.from('penyimpanan').select('*').order('id_sim', { ascending: true });
            
            navStorageItems = data || [];
            
            // Re-populate map
            storageMap = {};
            if (navStorageItems) {
                navStorageItems.forEach(s => storageMap[s.id_sim] = s.namasim);
            }

            // Init Sidebar Carousel
            initStorageNavCarousel();

            if (currentStorageTabId === null) fetchStorageList();
            else fetchDetailStorage(currentStorageTabId);
        }

        function initStorageNavCarousel(preserveState = false) {
            const track = document.getElementById('nav-storage-track');
            const dotsContainer = document.getElementById('nav-carousel-dots');
            
            const itemsPerSlide = 5;
            const totalItems = navStorageItems.length;
            const totalSlides = Math.ceil(totalItems / itemsPerSlide);

            if (!preserveState) {
                currentNavSlide = 0;
            }
            if (currentNavSlide >= totalSlides) currentNavSlide = totalSlides > 0 ? totalSlides - 1 : 0;

            let slidesHTML = '';
            for (let i = 0; i < totalSlides; i++) {
                let chunk = navStorageItems.slice(i * itemsPerSlide, (i + 1) * itemsPerSlide);
                let listHTML = '';
                
                chunk.forEach(s => {
                    const isActive = currentStorageTabId == s.id_sim ? 'is-active' : '';
                    listHTML += `<a class="${isActive}" onclick="switchStorageTab('${s.id_sim}', '${s.namasim}')">${s.namasim}</a>`;
                });
                
                slidesHTML += `<div class="carousel-slide">${listHTML}</div>`;
            }

            track.innerHTML = slidesHTML;
            
            let dotsHTML = '';
            if (totalSlides > 1) {
                for(let i=0; i<totalSlides; i++) {
                    dotsHTML += `<div class="dot ${i===currentNavSlide?'is-active':''}" onclick="goToNavSlide(${i})"></div>`;
                }
            }
            dotsContainer.innerHTML = dotsHTML;

            updateNavCarouselView();
            updateNavCarouselControls(totalSlides);
        }

        function updateNavCarouselView() {
            const track = document.getElementById('nav-storage-track');
            track.style.transform = `translateX(-${currentNavSlide * 100}%)`;
            
            const dots = document.querySelectorAll('#nav-carousel-dots .dot');
            dots.forEach((d, index) => {
                if(index === currentNavSlide) d.classList.add('is-active');
                else d.classList.remove('is-active');
            });
        }

        function nextNavSlide() {
            const track = document.getElementById('nav-storage-track');
            const totalSlides = track.children.length;
            if (currentNavSlide < totalSlides - 1) {
                currentNavSlide++;
                updateNavCarouselView();
                updateNavCarouselControls(totalSlides);
            }
        }

        function prevNavSlide() {
            if (currentNavSlide > 0) {
                currentNavSlide--;
                updateNavCarouselView();
                updateNavCarouselControls(document.getElementById('nav-storage-track').children.length);
            }
        }

        function goToNavSlide(index) {
            currentNavSlide = index;
            updateNavCarouselView();
            updateNavCarouselControls(document.getElementById('nav-storage-track').children.length);
        }

        function updateNavCarouselControls(total) {
            const prevBtn = document.getElementById('nav-prev-btn');
            const nextBtn = document.getElementById('nav-next-btn');
            
            if (prevBtn) prevBtn.disabled = currentNavSlide === 0;
            if (nextBtn) nextBtn.disabled = currentNavSlide === total - 1;
            
            // Optional: Hide buttons if only 1 slide exists
            if(total <= 1) {
               if(prevBtn) prevBtn.parentElement.style.display = 'none';
            } else {
               if(prevBtn) prevBtn.parentElement.style.display = 'grid';
            }
        }

        async function fetchStorageList() {
            const { data: stores } = await supabaseClient.from('penyimpanan').select('*');
            const { data: trxs } = await supabaseClient.from('keuangan').select('id_sim, saldo, transaksi');

            const balances = {};
            if (stores) {
                stores.forEach(s => balances[s.id_sim] = 0);
            }

            if (trxs) {
                trxs.forEach(t => {
                    if (balances[t.id_sim] !== undefined) {
                        if (t.transaksi === 'Pemasukan') balances[t.id_sim] += t.saldo;
                        else balances[t.id_sim] -= t.saldo;
                    }
                });
            }

            const tbody = document.getElementById('tbody-penyimpanan-list');
            tbody.innerHTML = '';

            if (stores) {
                stores.forEach((s) => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td>
                            <button class="button is-small is-info is-light" onclick="openEditStorage('${s.id_sim}', '${s.namasim}')"><i class="ph ph-pencil"></i></button>
                            <button class="button is-small is-danger is-light" onclick="deleteStorage('${s.id_sim}')"><i class="ph ph-trash"></i></button>
                        </td>
                        <td>${s.namasim}</td>
                        <td class="has-text-right font-weight-bold">${formatRupiah(balances[s.id_sim])}</td>
                    `;
                    tbody.appendChild(tr);
                });
            }
        }

        function switchStorageTab(id, name) {
            currentStorageTabId = id === 'all' ? null : id;
            currentStorageName = name || "";

            // Re-render carousel to update active class inside slides
            // PASS true to preserve current slide position
            initStorageNavCarousel(true); 
            
            // Also handle the static "All" button active state
            const allBtn = document.querySelector('#storage-tabs > a.is-active'); 
            // Reset main list active state if moving to a specific storage
            if (id !== 'all') {
               if(allBtn) allBtn.classList.remove('is-active');
            } else {
               const staticAll = document.querySelector('#storage-tabs > a');
               if(staticAll) staticAll.classList.add('is-active');
            }

            if (id === 'all') {
                document.getElementById('storage-view-all').classList.remove('is-hidden');
                document.getElementById('storage-view-detail').classList.add('is-hidden');
                loadPenyimpanan(); // Refresh list
            } else {
                document.getElementById('storage-view-all').classList.add('is-hidden');
                document.getElementById('storage-view-detail').classList.remove('is-hidden');
                document.getElementById('detail-storage-name').innerText = `Riwayat: ${name}`;

                activeFilter = { type: 'currentMonth' };
                fetchDetailStorage(id);
            }
        }

        async function fetchDetailStorage(idSim) {
            const stats = await calculateSummaryStats(idSim);
            renderSummaryText('summary-stats-storage', stats);

            const { data: allTimeTrx } = await supabaseClient.from('keuangan').select('saldo, transaksi').eq('id_sim', idSim);
            let bal = 0;
            if (allTimeTrx) {
                allTimeTrx.forEach(t => {
                    if (t.transaksi === 'Pemasukan') bal += t.saldo;
                    else bal -= t.saldo;
                });
            }
            currentStorageBalance = bal;
            document.getElementById('detail-storage-balance').innerText = formatRupiah(bal);

            let query = supabaseClient.from('keuangan').select('*').eq('id_sim', idSim);

            if (activeFilter.type === 'currentMonth') {
                const range = getCurrentMonthRange();
                query = query.gte('tanggal', range.start).lte('tanggal', range.end);
            } else if (activeFilter.type === 'range') {
                query = query.gte('tanggal', activeFilter.start).lte('tanggal', activeFilter.end);
            } else if (activeFilter.type === 'monthly') {
                const range = getMonthDateRange(activeFilter.year, activeFilter.month);
                query = query.gte('tanggal', range.start).lte('tanggal', range.end);
            } else if (activeFilter.type === 'yearly') {
                const range = getYearRange(activeFilter.year);
                query = query.gte('tanggal', range.start).lte('tanggal', range.end);
            }

            const { data, error } = await query.order('tanggal', { ascending: false });

            const tbody = document.getElementById('tbody-storage-detail');
            tbody.innerHTML = '';

            if (data && data.length > 0) {
                data.forEach(row => {
                    let badgeClass = '';
                    let textClass = '';
                    let trxLabel = row.transaksi;

                    if (row.transaksi === 'Pemasukan') {
                        badgeClass = 'is-success';
                        textClass = 'has-text-success-custom';
                    } else if (row.transaksi === 'Pengeluaran') {
                        badgeClass = 'is-danger';
                        textClass = 'has-text-danger-custom';
                    } else if (row.transaksi === 'Transfer') {
                        badgeClass = 'is-info';
                        textClass = 'has-text-info-custom';
                    }

                    tbody.innerHTML += `
                        <tr>
                            <td data-date="${row.tanggal}">${formatDate(row.tanggal)}</td>
                            <td><span class="tag ${badgeClass} is-light">${trxLabel}</span></td>
                            <td class="col-desc">${row.deskripsi}</td>
                            <td class="has-text-right ${textClass}">${formatRupiah(row.saldo)}</td>
                        </tr>
                    `;
                });
            } else {
                tbody.innerHTML = '<tr><td colspan="4" class="has-text-centered has-text-grey">Belum ada riwayat transaksi</td></tr>';
            }
        }

        async function saveNewStorage() {
            const name = document.getElementById('new-storage-name').value;
            if (!name) return;
            const { error } = await supabaseClient.from('penyimpanan').insert([{ namasim: name }]);
            if (!error) {
                Toast.fire({ icon: 'success', title: 'Penyimpanan Ditambah' });
                closeModal('modal-add-storage');
                loadPenyimpanan();
            }
        }

        function openEditStorage(id, name) {
            document.getElementById('edit-storage-id').value = id;
            document.getElementById('edit-storage-name').value = name;
            openModal('modal-edit-storage');
        }

        async function saveEditStorage() {
            const id = document.getElementById('edit-storage-id').value;
            const name = document.getElementById('edit-storage-name').value;
            const { error } = await supabaseClient.from('penyimpanan').update({ namasim: name }).eq('id_sim', id);
            if (!error) {
                Toast.fire({ icon: 'success', title: 'Berhasil diupdate' });
                closeModal('modal-edit-storage');
                loadPenyimpanan();
            }
        }

        async function deleteStorage(id) {
            Swal.fire({
                title: 'Hapus Penyimpanan?',
                text: "Data terkait akan ikut terhapus.",
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#d33',
                confirmButtonText: 'Ya, Hapus'
            }).then(async (result) => {
                if (result.isConfirmed) {
                    await supabaseClient.from('keuangan').delete().eq('id_sim', id);
                    const { error } = await supabaseClient.from('penyimpanan').delete().eq('id_sim', id);
                    if (!error) {
                        Toast.fire({ icon: 'success', title: 'Terhapus' });
                        loadPenyimpanan();
                    } else {
                        Toast.fire({ icon: 'error', title: 'Gagal Hapus' });
                    }
                }
            })
        }

        // --- 10. PAGE LOGIC: TRANSFER & VALIDATION ---
        async function loadTransfer() {
            const { data: stores } = await supabaseClient.from('penyimpanan').select('*');
            const src = document.getElementById('trf-source');
            const dst = document.getElementById('trf-dest');

            src.innerHTML = '<option value="" disabled selected>Pilih Sumber</option>';
            dst.innerHTML = '<option value="" disabled selected>Pilih Tujuan</option>';

            if (stores) {
                stores.forEach(s => {
                    const opt = `<option value="${s.id_sim}">${s.namasim}</option>`;
                    src.innerHTML += opt;
                    dst.innerHTML += opt;
                });
            }
        }

        async function handleTransferSubmit(e) {
            e.preventDefault();
            const date = document.getElementById('trf-date').value;
            const srcId = document.getElementById('trf-source').value;
            const dstId = document.getElementById('trf-dest').value;
            const amount = unformatRupiah(document.getElementById('trf-amount').value);
            const descSrc = document.getElementById('trf-desc-source').value;
            const descDst = document.getElementById('trf-desc-dest').value;

            if (srcId === dstId) return Toast.fire({ icon: 'error', title: 'Sumber dan Tujuan sama' });
            if (amount <= 0) return Toast.fire({ icon: 'warning', title: 'Nominal salah' });

            const { data: trxSource } = await supabaseClient.from('keuangan').select('saldo, transaksi').eq('id_sim', srcId);
            let currentSrcBalance = 0;
            if (trxSource) {
                trxSource.forEach(t => {
                    if (t.transaksi === 'Pemasukan') currentSrcBalance += t.saldo;
                    else currentSrcBalance -= t.saldo;
                });
            }

            if (currentSrcBalance < amount) {
                return Swal.fire({
                    icon: 'error',
                    title: 'Saldo Tidak Cukup!',
                    text: `Saldo saat ini: ${formatRupiah(currentSrcBalance)}. Tidak cukup untuk transfer ${formatRupiah(amount)}.`
                });
            }

            const op1 = await supabaseClient.from('keuangan').insert([{
                id_sim: srcId, tanggal: date, transaksi: 'Transfer', saldo: amount, deskripsi: descSrc
            }]);

            if (op1.error) return Toast.fire({ icon: 'error', title: 'Gagal tahap 1: ' + op1.error.message });

            const op2 = await supabaseClient.from('keuangan').insert([{
                id_sim: dstId, tanggal: date, transaksi: 'Pemasukan', saldo: amount, deskripsi: descDst
            }]);

            if (op2.error) {
                Toast.fire({ icon: 'error', title: 'Gagal tahap 2' });
            } else {
                Swal.fire({
                    icon: 'success',
                    title: 'Transfer Berhasil',
                    text: `Berhasil transfer Rp ${formatRupiah(amount)}`
                });
                resetForm('form-transfer');
            }
        }

        // --- 11. PDF DOWNLOAD & SORTING ---
        function sortData(dir, tableId) {
            const table = document.getElementById(tableId);
            const tbody = table.querySelector('tbody');
            const rows = Array.from(tbody.querySelectorAll('tr'));

            const isStorage = tableId === 'table-storage-detail';
            const btnAsc = document.getElementById(isStorage ? 'sort-asc-storage' : 'sort-asc-btn');
            const btnDesc = document.getElementById(isStorage ? 'sort-desc-storage' : 'sort-desc-btn');

            if (btnAsc) btnAsc.classList.remove('is-sort-active');
            if (btnDesc) btnDesc.classList.remove('is-sort-active');

            if (dir === 'asc' && btnAsc) btnAsc.classList.add('is-sort-active');
            else if (btnDesc) btnDesc.classList.add('is-sort-active');

            rows.sort((a, b) => {
                const dateA = new Date(a.cells[0].getAttribute('data-date'));
                const dateB = new Date(b.cells[0].getAttribute('data-date'));
                return dir === 'asc' ? dateA - dateB : dateB - dateA;
            });

            tbody.innerHTML = '';
            rows.forEach(row => tbody.appendChild(row));
        }

        function downloadPDF(tableId, title = "Laporan Keuangan") {
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF({ orientation: 'landscape' });

            doc.text(title, 14, 15);
            doc.setFontSize(10);
            doc.text(`Dicetak pada: ${new Date().toLocaleString()}`, 14, 22);

            doc.text("Ringkasan:", 14, 30);
            doc.text(`Bulan Ini - Masuk: ${formatRupiah(summaryStats.mIn)}, Keluar: ${formatRupiah(summaryStats.mOut)}`, 14, 35);
            doc.text(`Tahun Ini - Masuk: ${formatRupiah(summaryStats.yIn)}, Keluar: ${formatRupiah(summaryStats.yOut)}`, 14, 40);

            doc.autoTable({
                html: '#' + tableId,
                startY: 45,
                theme: 'grid',
                styles: { fontSize: 8, cellWidth: 'wrap' }, // Ensure text wrap
                headStyles: { fillColor: [17, 103, 177] },
                columnStyles: {
                    3: { cellWidth: 80 } // Force description column width
                }
            });

            doc.save('Laporan_Keuangan.pdf');
        }

        function downloadStoragePDF() {
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF({ orientation: 'landscape' });

            doc.setFontSize(14);
            doc.text(`Laporan Penyimpanan: ${currentStorageName}`, 14, 15);
            doc.setFontSize(10);
            doc.text(`Dicetak pada: ${new Date().toLocaleString()}`, 14, 22);

            doc.setFontSize(12);
            doc.setTextColor(17, 103, 177);
            doc.text(`Total Saldo Saat Ini: ${formatRupiah(currentStorageBalance)}`, 14, 32);
            doc.setTextColor(0, 0, 0);
            doc.setFontSize(10);

            doc.text(`Bulan Ini - Masuk: ${formatRupiah(summaryStats.mIn)}, Keluar: ${formatRupiah(summaryStats.mOut)}`, 14, 40);
            doc.text(`Tahun Ini - Masuk: ${formatRupiah(summaryStats.yIn)}, Keluar: ${formatRupiah(summaryStats.yOut)}`, 14, 45);

            doc.autoTable({
                html: '#table-storage-detail',
                startY: 50,
                theme: 'grid',
                styles: { fontSize: 8, cellWidth: 'wrap' },
                headStyles: { fillColor: [17, 103, 177] },
                columnStyles: {
                    2: { cellWidth: 80 } // Force description column width
                }
            });

            doc.save(`Laporan_${currentStorageName}.pdf`);
        }

        function downloadChartPDF() {
            const canvas = document.getElementById('financeChart');
            const canvasImg = canvas.toDataURL("image/png", 1.0);
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF('landscape');

            doc.setFontSize(14);
            doc.text("Analisa Keuangan (Grafik)", 14, 15);
            doc.addImage(canvasImg, 'PNG', 15, 20, 260, 120);
            doc.save('Grafik_Keuangan.pdf');
                }
