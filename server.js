const express = require('express');
const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');
const cheerio = require('cheerio');
const https = require('https');

const app = express();
const stealthAgent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  next();
});

const delay = ms => new Promise(res => setTimeout(res, ms));

function formatStr(dateObj, timeStr) {
    let y = dateObj.getFullYear();
    let m = String(dateObj.getMonth() + 1).padStart(2, '0');
    let d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d} ${timeStr}`;
}

// ====================================================
// 1. Scraper API untuk QRIS AUTOGATE
// ====================================================
app.get('/api/autogate', async (req, res) => {
    try {
        const jar = new CookieJar();
        const client = wrapper(axios.create({ 
            jar, withCredentials: true, baseURL: 'https://apps.flazzqris.com', timeout: 30000, 
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        }));

        const loginPage = await client.get('/login');
        const $ = cheerio.load(loginPage.data);
        const csrfToken = $('meta[name="csrf-token"]').attr('content');

        const loginData = new URLSearchParams();
        loginData.append('_token', csrfToken);
        loginData.append('email', 'phangkasakalvin@gmail.com');
        loginData.append('password', 'Mainayo88@');

        await client.post('/login', loginData.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Referer': 'https://apps.flazzqris.com/login' },
            maxRedirects: 0, validateStatus: status => status >= 200 && status < 400 
        });

        await delay(1000);

        const dashboardReq = await client.get('/dashboard');
        const $dash = cheerio.load(dashboardReq.data);
        
        let rawSaldo = '0';
        $dash('p.mb-0').each((i, el) => {
            if ($dash(el).text().trim() === 'Available Withdraw Amount') { rawSaldo = $dash(el).next('h5').text().trim(); }
        });
        let cleanSaldo = parseFloat(rawSaldo.replace(/IDR/g, '').trim().split(',')[0].replace(/\./g, '')) || 0;

        const reqDate = req.query.date;
        let target = reqDate ? new Date(reqDate) : new Date(); 
        let nextDay = new Date(target); nextDay.setDate(nextDay.getDate() + 1);
        let min2Day = new Date(target); min2Day.setDate(min2Day.getDate() - 2);
        let min1Day = new Date(target); min1Day.setDate(min1Day.getDate() - 1);

        let d_H_00 = encodeURIComponent(formatStr(target, "00:00"));
        let d_Hplus1_00 = encodeURIComponent(formatStr(nextDay, "00:00"));
        let d_Hmin2_23 = encodeURIComponent(formatStr(min2Day, "23:00"));
        let d_Hmin1_23 = encodeURIComponent(formatStr(min1Day, "23:00"));

        const fetchJsonWithRetry = async (url) => {
            for (let i = 0; i < 3; i++) {
                try {
                    const response = await client.get(url);
                    if (typeof response.data === 'object' && response.data !== null) return response; 
                } catch (e) {
                    if (i === 2) throw e;
                }
                await delay(1500);
            }
            return { data: {} };
        };

        const fetchHtmlWithRetry = async (url) => {
            for (let i = 0; i < 3; i++) {
                try {
                    const response = await client.get(url);
                    if (typeof response.data === 'string' && response.data.includes('Total Transaction')) return response;
                } catch (e) {
                    if (i === 2) throw e;
                }
                await delay(1500);
            }
            return { data: "" };
        };

        const resB2C = await fetchJsonWithRetry(`/withdraw-transaction/b2c/statistics?dateFrom=${d_H_00}&dateTo=${d_Hplus1_00}`);
        await delay(500); 
        const resDaily = await fetchJsonWithRetry(`/withdraw-transaction/statistics?dateFrom=${d_H_00}&dateTo=${d_Hplus1_00}`);
        await delay(500);
        const resSettle = await fetchJsonWithRetry(`/dynamic-transaction/statistics?dateFrom=${d_Hmin2_23}&dateTo=${d_Hmin1_23}&transaction=ALL`);
        await delay(500);
        const resDepoHTML = await fetchHtmlWithRetry(`/dynamic-transaction?limit=50&dateFrom=${d_H_00}&dateTo=${d_Hplus1_00}&transaction=ALL`);

        let b2cSum = resB2C.data?.data?.approved?.sum ?? resB2C.data?.approved?.sum ?? 0;
        let b2cFee = resB2C.data?.data?.approved?.fee ?? resB2C.data?.approved?.fee ?? 0;
        let dailyFee = resDaily.data?.data?.report_fee?.sum ?? resDaily.data?.report_fee?.sum ?? 0;
        let wdSum = resDaily.data?.data?.approved?.sum ?? resDaily.data?.approved?.sum ?? 0;
        let wdFee = resDaily.data?.data?.approved?.fee ?? resDaily.data?.approved?.fee ?? 0;
        let settleWallet = resSettle.data?.data?.DONE?.total ?? resSettle.data?.DONE?.total ?? 0;

        let depoAjaibStr = "0"; let depoAjaibNum = 0;
        let match = resDepoHTML.data.match(/Total Transaction:\s*IDR\s*([\d\.]+)/);
        if (match && match[1]) { depoAjaibStr = match[1]; depoAjaibNum = parseInt(depoAjaibStr.replace(/\./g, ''), 10); }
        let depoFeeNum = Math.round(depoAjaibNum * 0.011);

        const tanggalTampil = formatStr(target, "").trim();
        const makeCounter = (val, colorClass="text-white") => `<span class="num-counter font-data text-[16px] font-bold tracking-wider ${colorClass}" data-target="${parseFloat(String(val).replace(/\./g, '')) || 0}">0</span>`;

        const hasilAkhir = `
            <div class="flex flex-col w-full max-w-xl mx-auto h-full font-sans animate-[fadeIn_0.5s_ease-out]">
                <div class="flex justify-between items-center pb-3 mb-2 border-b border-white/10">
                    <span class="text-xs text-gray-400 uppercase tracking-[0.2em] font-bold">Log Snapshot</span>
                    <span class="text-[14px] text-white font-data bg-white/5 px-3 py-1.5 rounded-md border border-white/20 font-bold">${tanggalTampil}</span>
                </div>
                
                <div class="flex flex-col flex-1">
                    <div class="flex justify-between py-3.5 border-b border-white/10 hover:bg-white/10 transition-colors px-4 rounded-lg">
                        <span class="text-gray-200 text-[15px] font-medium tracking-wide">SALDO AUTOGATE</span>
                        <span class="text-cyan-400 font-data text-base tracking-tight">${makeCounter(cleanSaldo)}</span>
                    </div>
                    <div class="flex justify-between py-3.5 border-b border-white/10 hover:bg-white/10 transition-colors px-4 rounded-lg">
                        <span class="text-gray-200 text-[15px] font-medium tracking-wide">AUTO WD AUTOGATE</span>
                        <span class="text-white font-data text-base tracking-tight">${makeCounter(b2cSum)}</span>
                    </div>
                    <div class="flex justify-between py-3.5 border-b border-white/10 hover:bg-white/10 transition-colors px-4 rounded-lg">
                        <span class="text-gray-200 text-[15px] font-medium tracking-wide">ADMIN AUTO WD AUTOGATE</span>
                        <span class="text-white font-data text-base tracking-tight">${makeCounter(b2cFee)}</span>
                    </div>
                    <div class="flex justify-between py-3.5 border-b border-white/10 hover:bg-white/10 transition-colors px-4 rounded-lg">
                        <span class="text-gray-200 text-[15px] font-medium tracking-wide">DAILY FEE AUTOGATE</span>
                        <span class="text-white font-data text-base tracking-tight">${makeCounter(dailyFee)}</span>
                    </div>
                    <div class="flex justify-between py-3.5 border-b border-white/10 hover:bg-white/10 transition-colors px-4 rounded-lg">
                        <span class="text-gray-200 text-[15px] font-medium tracking-wide">SETTLEMENT WALLET AUTOGATE</span>
                        <span class="text-white font-data text-base tracking-tight">${makeCounter(settleWallet)}</span>
                    </div>
                    <div class="flex justify-between py-3.5 border-b border-white/10 hover:bg-white/10 transition-colors px-4 rounded-lg">
                        <span class="text-gray-200 text-[15px] font-medium tracking-wide">DEPO AUTOGATE</span>
                        <span class="text-white font-data text-base tracking-tight">${makeCounter(depoAjaibNum)}</span>
                    </div>
                    <div class="flex justify-between py-3.5 border-b border-white/10 hover:bg-white/10 transition-colors px-4 rounded-lg">
                        <span class="text-gray-200 text-[15px] font-medium tracking-wide">FEE DEPO AUTOGATE</span>
                        <span class="text-white font-data text-base tracking-tight">${makeCounter(depoFeeNum)}</span>
                    </div>
                    <div class="flex justify-between py-3.5 border-b border-white/10 hover:bg-white/10 transition-colors px-4 rounded-lg">
                        <span class="text-gray-200 text-[15px] font-medium tracking-wide">WD TRANSACTION AUTOGATE</span>
                        <span class="text-white font-data text-base tracking-tight">${makeCounter(wdSum)}</span>
                    </div>
                    <div class="flex justify-between py-3.5 border-b border-transparent hover:bg-white/10 transition-colors px-4 rounded-lg">
                        <span class="text-gray-200 text-[15px] font-medium tracking-wide">FEE WD TRANSACTION AUTOGATE</span>
                        <span class="text-white font-data text-base tracking-tight">${makeCounter(wdFee)}</span>
                    </div>
                </div>
            </div>
            <style>@keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }</style>
        `;

        res.json({ status: 'sukses', data: hasilAkhir });

    } catch (error) {
        console.error("Autogate Extractor Error:", error.message);
        res.status(500).json({ status: 'error', pesan: 'Gagal menarik data spesifik dari API Autogate.' });
    }
});

// ====================================================
// 2. Scraper API untuk QRIS MVP (MURNI HEADER FIREFOX TANPA ORIGIN)
// ====================================================
app.get('/api/mvp', async (req, res) => {
    try {
        const reqDate = req.query.date;
        let target = reqDate ? new Date(reqDate) : new Date(); 
        const dd = String(target.getDate()).padStart(2, '0');
        const mm = String(target.getMonth() + 1).padStart(2, '0');
        const yyyy = target.getFullYear();
        const targetDateAPI = `${dd}-${mm}-${yyyy}`;
        const tanggalTampil = `${yyyy}-${mm}-${dd}`; 

        const token = "eyJhbGciOiJIUzUxMiJ9.eyJzdWIiOiJTVEFGRkFHQU0iLCJhcGlDbGllbnQiOmZhbHNlLCJyb2xlcyI6IkZJTkFOQ0UiLCJuYW1lIjoiU1RBRkZBR0FNIiwiYWRtaW4iOmZhbHNlLCJzdGFmZiI6dHJ1ZSwiaWQiOjE2NDEsImV4cCI6MTc5Mzc4MDAxMCwiaWF0IjoxNzkzMTc1MjEwLCJlbWFpbCI6ImFnYW02OUBtdnBhcGkuY29tIn0.QV-f-NuT5laqyR5fbGziK_CkrjaIm1ZfGgHC8ZpMc8mOZRWNqlFrjHF6qJLSg1pfQNTIeG4qdmaYTLFT-XIt7g";

        // Persis mengikuti GET.txt Firefox (Tanpa header Origin yang memicu 403 di Spring Boot)
        const apiHeaders = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:158.0) Gecko/20100101 Firefox/158.0',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Authorization': `Bearer ${token}`,
            'Referer': 'https://qrismvp.com/staff/disburstment',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-origin',
            'Connection': 'keep-alive'
        };

        const postHeaders = {
            ...apiHeaders,
            'Content-Type': 'application/json'
        };

        const basePayload = { dateStartString: targetDateAPI, dateEndString: targetDateAPI, page: 1, size: 10000 };

        const fetchMvpWithRetry = async (url, payload, headers, retries = 2) => {
            for (let i = 0; i < retries; i++) {
                try {
                    const response = await axios.post(url, payload, { headers: headers, timeout: 30000, httpsAgent: stealthAgent });
                    if (response && response.data) return response;
                } catch (e) {
                    if (i === retries - 1) throw e;
                    await delay(1000);
                }
            }
        };

        const getMvpWithRetry = async (url, headers, retries = 2) => {
            for (let i = 0; i < retries; i++) {
                try {
                    const response = await axios.get(url, { headers: headers, timeout: 30000, httpsAgent: stealthAgent });
                    if (response && response.data) return response;
                } catch (e) {
                    if (i === retries - 1) throw e;
                    await delay(1000);
                }
            }
        };

        let saldoMVP = 0;
        const resBalanceMvp = await getMvpWithRetry('https://qrismvp.com/api/staff-menu/balance', apiHeaders);
        if (resBalanceMvp && resBalanceMvp.data && resBalanceMvp.data.content) {
            saldoMVP = parseFloat(resBalanceMvp.data.content.active) || 0;
        }

        const resTrans = await fetchMvpWithRetry('https://qrismvp.com/api/staff-menu/transaction/summary', { ...basePayload, status: 1 }, postHeaders);
        let varDeposit = resTrans.data?.content?.amount || 0;
        let varFeeDeposit = resTrans.data?.content?.fee || 0;
        await delay(300); 

        const resDisb = await fetchMvpWithRetry('https://qrismvp.com/api/staff-menu/transfer-history/paging?status_db=SUCCESS', { ...basePayload, status_db: "SUCCESS" }, postHeaders);
        let totalSuccessCount = resDisb.data?.content?.totalElements || 0;
        let countWeb173 = 0, globalValue = 0, varWeb173 = 0;

        if (resDisb.data?.content?.content) {
            resDisb.data.content.content.forEach(item => {
                globalValue += item.amount;
                if (item.refId && item.refId.includes('WEB-173')) { varWeb173 += item.amount; countWeb173++; }
            });
        }
        
        let varDisbWD = globalValue - varWeb173;
        let varNet = globalValue;
        let varFeeDisbWD = (totalSuccessCount - countWeb173) * 1700;
        await delay(300);

        let searchLain = "By Lain Lain";
        const resLain = await fetchMvpWithRetry(`https://qrismvp.com/api/staff-menu/mutasi-saldo/paging?search=${encodeURIComponent(searchLain)}`, { ...basePayload, search: searchLain }, postHeaders);
        let varByLain = 0;
        if (resLain.data?.content?.content) { resLain.data.content.content.forEach(item => { varByLain += Math.abs(item.credit || 0); }); }
        await delay(300);

        let searchInject = "inject";
        const resInject = await fetchMvpWithRetry(`https://qrismvp.com/api/staff-menu/mutasi-saldo/paging?search=${encodeURIComponent(searchInject)}`, { ...basePayload, search: searchInject }, postHeaders);
        let varInject = 0;
        if (resInject.data?.content?.content) { resInject.data.content.content.forEach(item => { varInject += Math.abs(item.debit || 0); }); }

        const makeCounter = (val, colorClass="text-white") => `<span class="num-counter font-data text-[16px] font-bold tracking-wider ${colorClass}" data-target="${Math.round(val || 0)}">0</span>`;

        const hasilAkhirMVP = `
            <div class="flex flex-col w-full max-w-xl mx-auto h-full font-sans animate-[fadeIn_0.5s_ease-out]">
                <div class="flex justify-between items-center pb-3 mb-2 border-b border-white/10">
                    <span class="text-xs text-gray-400 uppercase tracking-[0.2em] font-bold">Log Snapshot</span>
                    <span class="text-[14px] text-white font-data bg-white/5 px-3 py-1.5 rounded-md border border-white/20 font-bold">${tanggalTampil}</span>
                </div>
                
                <div class="flex flex-col flex-1">
                    <div class="flex justify-between py-3.5 border-b border-white/10 hover:bg-white/10 transition-colors px-4 rounded-lg">
                        <span class="text-gray-200 text-[15px] font-medium tracking-wide">SALDO MVP</span>
                        <span class="text-pink-400 font-data text-base tracking-tight">${makeCounter(saldoMVP)}</span>
                    </div>
                    <div class="flex justify-between py-3.5 border-b border-white/10 hover:bg-white/10 transition-colors px-4 rounded-lg">
                        <span class="text-gray-200 text-[15px] font-medium tracking-wide">DEPO MVP</span>
                        <span class="text-white font-data text-base tracking-tight">${makeCounter(varDeposit)}</span>
                    </div>
                    <div class="flex justify-between py-3.5 border-b border-white/10 hover:bg-white/10 transition-colors px-4 rounded-lg">
                        <span class="text-gray-200 text-[15px] font-medium tracking-wide">FEE DEPO MVP</span>
                        <span class="text-white font-data text-base tracking-tight">${makeCounter(varFeeDeposit)}</span>
                    </div>
                    <div class="flex justify-between py-3.5 border-b border-white/10 hover:bg-white/10 transition-colors px-4 rounded-lg">
                        <span class="text-gray-200 text-[15px] font-medium tracking-wide">AUTO WD MVP</span>
                        <span class="text-white font-data text-base tracking-tight">${makeCounter(varDisbWD)}</span>
                    </div>
                    <div class="flex justify-between py-3.5 border-b border-white/10 hover:bg-white/10 transition-colors px-4 rounded-lg">
                        <span class="text-gray-200 text-[15px] font-medium tracking-wide">FEE AUTO WD MVP</span>
                        <span class="text-white font-data text-base tracking-tight">${makeCounter(varFeeDisbWD)}</span>
                    </div>
                    <div class="flex justify-between py-3.5 border-b border-white/10 hover:bg-white/10 transition-colors px-4 rounded-lg">
                        <span class="text-gray-200 text-[15px] font-medium tracking-wide">SETTLEMENT MVP</span>
                        <span class="text-white font-data text-base tracking-tight">${makeCounter(varWeb173)}</span>
                    </div>
                    <div class="flex justify-between py-3.5 border-b border-white/10 hover:bg-white/10 transition-colors px-4 rounded-lg">
                        <span class="text-gray-200 text-[15px] font-medium tracking-wide">NET MVP</span>
                        <span class="text-white font-data text-base tracking-tight">${makeCounter(varNet)}</span>
                    </div>
                    <div class="flex justify-between py-3.5 border-b border-white/10 hover:bg-white/10 transition-colors px-4 rounded-lg">
                        <span class="text-gray-200 text-[15px] font-medium tracking-wide">PENGELUARAN MVP</span>
                        <span class="text-white font-data text-base tracking-tight">${makeCounter(varByLain)}</span>
                    </div>
                    <div class="flex justify-between py-3.5 border-b border-transparent hover:bg-white/10 transition-colors px-4 rounded-lg">
                        <span class="text-gray-200 text-[15px] font-medium tracking-wide">PEMASUKAN MVP</span>
                        <span class="text-white font-data text-base tracking-tight">${makeCounter(varInject)}</span>
                    </div>
                </div>
            </div>
            <style>@keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }</style>
        `;

        res.json({ status: 'sukses', data: hasilAkhirMVP });

    } catch (error) {
        const gagalUrl = error.config?.url || 'Unknown URL';
        const responMvp = error.response?.data 
            ? (typeof error.response.data === 'string' ? error.response.data.substring(0, 120) : JSON.stringify(error.response.data).substring(0, 120))
            : 'Tanpa detail respon';
        console.error("MVP Extractor Error:", gagalUrl, error.message, responMvp);
        res.status(500).json({ 
            status: 'error', 
            pesan: `Gagal di [${gagalUrl}] (${error.message}) | Detail MVP: ${responMvp}` 
        });
    }
});

// ====================================================
// 3. Scraper API untuk QRIS MPAY
// ====================================================
app.get('/api/mpay', async (req, res) => {
    try {
        const jar = new CookieJar();
        
        const client = wrapper(axios.create({
            jar, 
            withCredentials: true, 
            baseURL: 'https://v2.mpayble.com', 
            timeout: 60000,
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Origin': 'https://v2.mpayble.com',
                'Referer': 'https://v2.mpayble.com/login',
                'Accept': 'application/json, text/plain, */*'
            }
        }));

        const postMpayWithRetry = async (url, payload, headers, retries = 3) => {
            for (let i = 0; i < retries; i++) {
                try {
                    const response = await client.post(url, payload, { headers: headers, timeout: 45000 });
                    if (response && response.data) return response;
                } catch (e) {
                    console.log(`[MPAY] Attempt ${i + 1} failed for ${url}:`, e.message);
                    if (i === retries - 1) throw e; 
                    await delay(3000); 
                }
            }
        };

        const loginData = new URLSearchParams();
        loginData.append('email', 'agambot.new@gmail.com');
        loginData.append('password', 'FFWM0H5NEZC');
        
        await postMpayWithRetry('/login', loginData.toString(), { 
            'Content-Type': 'application/x-www-form-urlencoded', 
            'x-sveltekit-action': 'true' 
        });

        client.defaults.headers['Referer'] = 'https://v2.mpayble.com/';
        await delay(1000);

        const reqDate = req.query.date;
        let target = reqDate ? new Date(reqDate) : new Date();
        const selectedDate = formatStr(target, "").trim();

        let min2Day = new Date(target); min2Day.setDate(min2Day.getDate() - 2);
        let min1Day = new Date(target); min1Day.setDate(min1Day.getDate() - 1);
        const cutoffStart = `${formatStr(min2Day, "").trim()}T23:00:01.000+07:00`;
        const cutoffEnd = `${formatStr(min1Day, "").trim()}T23:00:00.999+07:00`;

        const safeParseMpay = (jsonResponse) => {
            if (!jsonResponse || !jsonResponse.data) return null;
            try {
                let rawArr = JSON.parse(jsonResponse.data);
                return JSON.parse(rawArr[0]);
            } catch (e) { return null; }
        };

        const getPayload = (filters, start, end, length) => {
            const params = new URLSearchParams();
            params.append('orders', '[{"column":0,"dir":"desc"}]');
            params.append('columns', '[{"data":"created_at","dir":"desc"}]');
            params.append('filters', filters);
            params.append('range', JSON.stringify({ start: start, end: end }));
            params.append('length', length);
            params.append('start', '0');
            return params.toString(); 
        };

        const svelteActionHeader = { 
            'Content-Type': 'application/x-www-form-urlencoded',
            'x-sveltekit-action': 'true'
        };

        let totalAmount = 0, totalFee = 0, settlementAmount = 0, wdAmount = 0, wdFee = 0;

        let saldoMPAY = 0;
        const payloadBalanceMpay = new URLSearchParams();
        payloadBalanceMpay.append('filters', '[]');
        payloadBalanceMpay.append('length', '6');
        payloadBalanceMpay.append('start', '0');

        const resMpayBalance = await postMpayWithRetry('/?/getMerchantAccountList', payloadBalanceMpay.toString(), svelteActionHeader);
        let parsedMpayBalance = safeParseMpay(resMpayBalance?.data);
        if (parsedMpayBalance && parsedMpayBalance.data && parsedMpayBalance.data.data) {
            let accountData = parsedMpayBalance.data.data;
            if (accountData.length > 0) {
                saldoMPAY = parseFloat(accountData[0].t_ma_sb) || 0;
            }
        }
        await delay(500);

        const payload1 = getPayload('[{"key":"status","value":"5"},{"key":"merchant_ref_code","value":"TMF-03"}]', selectedDate, selectedDate, '-1');
        const res1 = await postMpayWithRetry('/transaction/incoming?/getIncomingTransactions', payload1, svelteActionHeader);
        
        let parsedTrx = safeParseMpay(res1?.data);
        if (parsedTrx && parsedTrx.data && parsedTrx.data.data) {
            parsedTrx.data.data.forEach(trx => {
                totalAmount += parseFloat(trx.t_ie_amt) || 0;
                totalFee += parseFloat(trx.t_ie_tf) || 0;
            });
        }
        await delay(500);

        const payload2 = getPayload('[{"key":"status","value":"5"},{"key":"merchant_ref_code","value":"TMF-03"},{"key":"paid_at","value":true}]', cutoffStart, cutoffEnd, '1');
        const res2 = await postMpayWithRetry('/transaction/incoming?/getIncomingTransactions', payload2, svelteActionHeader);
        
        let parsedSet = safeParseMpay(res2?.data);
        if (parsedSet && parsedSet.data && parsedSet.data.other) {
            let otherStats = parsedSet.data.other;
            if (otherStats.length > 0) {
                let stat = otherStats.find(s => s.is_s === 5) || otherStats[0];
                settlementAmount = stat.is_t || 0;
            }
        }
        await delay(500);

        const payload3 = getPayload('[{"key":"status","value":"5"},{"key":"merchant_ref_code","value":"TMF-03"},{"key":"is_settlement","value":"false"}]', selectedDate, selectedDate, '-1');
        const res3 = await postMpayWithRetry('/transaction/outgoing?/getOutgoingTransaction', payload3, svelteActionHeader);
        
        let parsedWd = safeParseMpay(res3?.data);
        if (parsedWd && parsedWd.data && parsedWd.data.data) {
            parsedWd.data.data.forEach(trx => {
                wdAmount += parseFloat(trx.t_oe_amt) || 0;
                wdFee += parseFloat(trx.t_oe_tf) || 0;
            });
        }

        const makeCounter = (val, colorClass="text-white") => `<span class="num-counter font-data text-[16px] font-bold tracking-wider ${colorClass}" data-target="${Math.round(val || 0)}">0</span>`;

        const hasilAkhirMPAY = `
            <div class="flex flex-col w-full max-w-xl mx-auto h-full font-sans animate-[fadeIn_0.5s_ease-out]">
                <div class="flex justify-between items-center pb-3 mb-2 border-b border-white/10">
                    <span class="text-xs text-gray-400 uppercase tracking-[0.2em] font-bold">Log Snapshot</span>
                    <span class="text-[14px] text-white font-data bg-white/5 px-3 py-1.5 rounded-md border border-white/20 font-bold">${selectedDate}</span>
                </div>
                
                <div class="flex flex-col flex-1">
                    <div class="flex justify-between py-3.5 border-b border-white/10 hover:bg-white/10 transition-colors px-4 rounded-lg">
                        <span class="text-gray-200 text-[15px] font-medium tracking-wide">SALDO MPAY</span>
                        <span class="text-purple-400 font-data text-base tracking-tight">${makeCounter(saldoMPAY)}</span>
                    </div>
                    <div class="flex justify-between py-3.5 border-b border-white/10 hover:bg-white/10 transition-colors px-4 rounded-lg">
                        <span class="text-gray-200 text-[15px] font-medium tracking-wide">DEPO MPAY</span>
                        <span class="text-white font-data text-base tracking-tight">${makeCounter(totalAmount)}</span>
                    </div>
                    <div class="flex justify-between py-3.5 border-b border-white/10 hover:bg-white/10 transition-colors px-4 rounded-lg">
                        <span class="text-gray-200 text-[15px] font-medium tracking-wide">FEE DEPO MPAY</span>
                        <span class="text-white font-data text-base tracking-tight">${makeCounter(totalFee)}</span>
                    </div>
                    <div class="flex justify-between py-3.5 border-b border-white/10 hover:bg-white/10 transition-colors px-4 rounded-lg">
                        <span class="text-gray-200 text-[15px] font-medium tracking-wide">SETTLEMENT MPAY</span>
                        <span class="text-white font-data text-base tracking-tight">${makeCounter(settlementAmount)}</span>
                    </div>
                    <div class="flex justify-between py-3.5 border-b border-white/10 hover:bg-white/10 transition-colors px-4 rounded-lg">
                        <span class="text-gray-200 text-[15px] font-medium tracking-wide">AUTO WD MPAY</span>
                        <span class="text-white font-data text-base tracking-tight">${makeCounter(wdAmount)}</span>
                    </div>
                    <div class="flex justify-between py-3.5 border-b border-transparent hover:bg-white/10 transition-colors px-4 rounded-lg">
                        <span class="text-gray-200 text-[15px] font-medium tracking-wide">FEE AUTO WD MPAY</span>
                        <span class="text-white font-data text-base tracking-tight">${makeCounter(wdFee)}</span>
                    </div>
                </div>
            </div>
            <style>@keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }</style>
        `;

        res.json({ status: 'sukses', data: hasilAkhirMPAY });

    } catch (error) {
        console.error("MPAY Extractor Error:", error.message);
        res.status(500).json({ status: 'error', pesan: `Gagal menarik data dari server MPAY. Detail: ${error.message}` });
    }
});

// ====================================================
// Rute Halaman Utama (Biar tidak putih / Cannot GET)
// ====================================================
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/agamindex44.html');
});

app.listen(3000, () => {
    console.log('Server Backend API jalan di http://localhost:3000');
});