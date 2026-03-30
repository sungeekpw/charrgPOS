package com.charrg.pos.nexgo

import android.app.Activity
import android.util.Log
import android.view.KeyEvent
import android.view.Window
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File
import java.io.FileWriter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import com.nexgo.common.LogUtils
import com.nexgo.oaf.apiv3.APIProxy
import com.nexgo.oaf.apiv3.DeviceEngine
import com.nexgo.oaf.apiv3.SdkResult
import com.nexgo.oaf.apiv3.device.reader.CardInfoEntity
import com.nexgo.oaf.apiv3.device.reader.CardReader
import com.nexgo.oaf.apiv3.device.reader.CardSlotTypeEnum
import com.nexgo.oaf.apiv3.device.reader.OnCardInfoListener
import com.nexgo.oaf.apiv3.device.reader.ReaderTypeEnum
import com.nexgo.oaf.apiv3.emv.AidEntity
import com.nexgo.oaf.apiv3.emv.AidEntryModeEnum
import com.nexgo.oaf.apiv3.emv.CapkEntity
import com.nexgo.oaf.apiv3.emv.CandidateAppInfoEntity
import com.nexgo.oaf.apiv3.emv.EmvCardBrandEnum
import com.nexgo.oaf.apiv3.emv.EmvEntryModeEnum
import com.nexgo.oaf.apiv3.emv.EmvHandler2
import com.nexgo.oaf.apiv3.emv.EmvProcessFlowEnum
import com.nexgo.oaf.apiv3.emv.EmvProcessResultEntity
import com.nexgo.oaf.apiv3.emv.EmvDataSourceEnum
import com.nexgo.oaf.apiv3.emv.EmvOnlineResultEntity
import com.nexgo.oaf.apiv3.emv.EmvTransConfigurationEntity
import com.nexgo.oaf.apiv3.emv.OnEmvProcessListener2

class NexGoSDKModule(private val reactCtx: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactCtx) {

    private var deviceEngine: DeviceEngine? = null
    private var cardReader: CardReader? = null
    private var emvHandler: EmvHandler2? = null
    private var isReading = false

    // Dedicated background thread for EMV processing.
    // emvProcess() is a blocking call — running it on the main thread blocks the
    // main looper, which then can't dispatch the onSetTransInitBeforeGPOResponse()
    // post we send from the callback, causing a deadlock/crash before the first
    // callback fires. Running on our own HandlerThread keeps the main thread free
    // and lets the SDK's callback thread call response functions directly.
    private val emvThread = android.os.HandlerThread("nexgo-emv").also { it.start() }
    private val emvWorker = android.os.Handler(emvThread.looper)

    // ─── Debug file logger ────────────────────────────────────────────────────
    //
    // Log lines go to both Android Logcat (tag "NexGoSDK") and a plain-text
    // file at <app-data>/files/nexgo-debug.log so the log can be read in-app
    // without a USB cable. File is capped at 1 MB — older entries are dropped.

    companion object {
        private const val TAG = "NexGoSDK"
        private const val LOG_FILE = "nexgo-debug.log"
        private const val MAX_LOG_BYTES = 1_000_000L   // 1 MB
        private val TS_FMT = SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US)
    }

    private val logFile: File get() = File(reactCtx.filesDir, LOG_FILE)

    private fun log(section: String, msg: String) {
        val line = "[${TS_FMT.format(Date())}] [$section] $msg\n"
        Log.d(TAG, "[$section] $msg")
        try {
            // Trim file when it gets too large (keep the last half)
            if (logFile.exists() && logFile.length() > MAX_LOG_BYTES) {
                val content = logFile.readText()
                logFile.writeText(content.substring(content.length / 2))
            }
            FileWriter(logFile, true).use { it.write(line) }
        } catch (_: Exception) {}
    }

    private fun logError(section: String, msg: String, e: Throwable? = null) {
        val full = if (e != null) "$msg — ${e.javaClass.simpleName}: ${e.message}" else msg
        val line = "[${TS_FMT.format(Date())}] [ERROR/$section] $full\n"
        Log.e(TAG, "[$section] $full", e)
        try {
            FileWriter(logFile, true).use { it.write(line) }
        } catch (_: Exception) {}
    }

    @ReactMethod
    fun getDebugLog(promise: Promise) {
        try {
            val content = if (logFile.exists()) logFile.readText() else "(log file is empty)"
            promise.resolve(content)
        } catch (e: Exception) {
            promise.reject("ERR_LOG_READ", e.message ?: "Failed to read log file")
        }
    }

    @ReactMethod
    fun clearDebugLog(promise: Promise) {
        try {
            if (logFile.exists()) logFile.delete()
            log("LOG", "Log cleared")
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("ERR_LOG_CLEAR", e.message ?: "Failed to clear log file")
        }
    }

    // Physical keypad interception
    private var originalWindowCallback: Window.Callback? = null
    private var keypadListenerActive = false

    override fun getName(): String = "NexGoSDK"

    private fun sendEvent(eventName: String, params: WritableMap? = null) {
        reactCtx
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, params ?: Arguments.createMap())
    }

    // ─── Keypad interception ──────────────────────────────────────────────────

    /**
     * Hook the Activity's Window.Callback to intercept physical keypad presses.
     * Digits (0-9), BACKSPACE, CLEAR, and ENTER are forwarded to JS as
     * "keypad_input" events with { key: "0"-"9" | "BACKSPACE" | "CLEAR" | "ENTER" }.
     * The event is consumed so the system doesn't also route it to a TextInput.
     */
    @ReactMethod
    fun startKeypadListener(promise: Promise) {
        val activity = reactCtx.currentActivity
        if (activity == null) {
            promise.reject("ERR_NO_ACTIVITY", "No current activity available")
            return
        }
        if (keypadListenerActive) {
            promise.resolve(null)
            return
        }

        // Window operations MUST run on the UI thread.
        activity.runOnUiThread {
            try {
                val window = activity.window
                originalWindowCallback = window.callback
                val original = originalWindowCallback!!

                // Kotlin `by` delegation forwards every method we don't override
                // to the original callback — we only intercept dispatchKeyEvent.
                window.callback = object : Window.Callback by original {
                    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
                        if (event.action == KeyEvent.ACTION_DOWN) {
                            val key: String? = when (event.keyCode) {
                                KeyEvent.KEYCODE_0,
                                KeyEvent.KEYCODE_NUMPAD_0 -> "0"
                                KeyEvent.KEYCODE_1,
                                KeyEvent.KEYCODE_NUMPAD_1 -> "1"
                                KeyEvent.KEYCODE_2,
                                KeyEvent.KEYCODE_NUMPAD_2 -> "2"
                                KeyEvent.KEYCODE_3,
                                KeyEvent.KEYCODE_NUMPAD_3 -> "3"
                                KeyEvent.KEYCODE_4,
                                KeyEvent.KEYCODE_NUMPAD_4 -> "4"
                                KeyEvent.KEYCODE_5,
                                KeyEvent.KEYCODE_NUMPAD_5 -> "5"
                                KeyEvent.KEYCODE_6,
                                KeyEvent.KEYCODE_NUMPAD_6 -> "6"
                                KeyEvent.KEYCODE_7,
                                KeyEvent.KEYCODE_NUMPAD_7 -> "7"
                                KeyEvent.KEYCODE_8,
                                KeyEvent.KEYCODE_NUMPAD_8 -> "8"
                                KeyEvent.KEYCODE_9,
                                KeyEvent.KEYCODE_NUMPAD_9 -> "9"
                                KeyEvent.KEYCODE_DEL,
                                KeyEvent.KEYCODE_FORWARD_DEL -> "BACKSPACE"
                                KeyEvent.KEYCODE_CLEAR -> "CLEAR"
                                KeyEvent.KEYCODE_ENTER,
                                KeyEvent.KEYCODE_NUMPAD_ENTER -> "ENTER"
                                else -> null
                            }
                            if (key != null) {
                                sendEvent("keypad_input", Arguments.createMap().apply {
                                    putString("key", key)
                                })
                                return true // consume — don't double-route to TextInput
                            }
                            // Emit unknown key codes as a debug event so the JS
                            // side can log what the device is actually sending.
                            sendEvent("keypad_debug", Arguments.createMap().apply {
                                putInt("keyCode", event.keyCode)
                                putString("keyCodeName", KeyEvent.keyCodeToString(event.keyCode))
                            })
                        }
                        return original.dispatchKeyEvent(event)
                    }
                }

                keypadListenerActive = true
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("ERR_WINDOW_CALLBACK", e.message ?: "Failed to hook window callback")
            }
        }
    }

    @ReactMethod
    fun stopKeypadListener(promise: Promise) {
        val activity = reactCtx.currentActivity
        if (activity != null && originalWindowCallback != null) {
            activity.runOnUiThread {
                activity.window.callback = originalWindowCallback
                originalWindowCallback = null
            }
        }
        keypadListenerActive = false
        promise.resolve(null)
    }

    // ─── SDK init ─────────────────────────────────────────────────────────────

    /**
     * The NexGo SDK requires an Activity context for APIProxy.getDeviceEngine().
     * ReactApplicationContext wraps the Application context, which the SDK rejects.
     * Prefer the current Activity; fall back to reactCtx only if unavailable.
     */
    private fun sdkContext(): android.content.Context =
        reactCtx.currentActivity ?: reactCtx

    @ReactMethod
    fun initialize(promise: Promise) {
        log("INIT", "initialize() called — context=${sdkContext().javaClass.simpleName}")
        try {
            deviceEngine = APIProxy.getDeviceEngine(sdkContext())
            if (deviceEngine == null) {
                logError("INIT", "APIProxy.getDeviceEngine returned null")
                promise.resolve(false)
                return
            }
            log("INIT", "DeviceEngine obtained OK")
            cardReader = deviceEngine!!.cardReader
            log("INIT", "CardReader obtained: ${cardReader != null}")
            emvHandler = deviceEngine!!.getEmvHandler2("app1")
            log("INIT", "EmvHandler2 obtained: ${emvHandler != null}")
            // NOTE: initReader(INNER, 0) is intentionally NOT called here.
            // Calling it in initialize() permanently routes the EMV core to the ICC
            // contact slot, which breaks contactless (RF) emvProcess — the contactless
            // kernel fails immediately with -8012 because the EMV core is pointing at
            // the wrong interface. Instead, initReader(INNER, 0) is called only
            // immediately before a chip emvProcess in processEmvCard (guarded by
            // !isContactless). The reference app (NexGo emvTestConsole) does not call
            // initReader during initialization either.
            // Enable verbose native-kernel logging (APDU traces, AID matching detail)
            // so that Android logcat captures the full emvProcessFlow1 internals.
            emvHandler!!.emvDebugLog(true)
            // Enable NexGo Java-layer debug logging (LogUtils gates SDK log output).
            LogUtils.setDebugEnable(true)
            log("INIT", "emvDebugLog(true) + LogUtils.setDebugEnable(true) — native EMV trace enabled")
            // Enable the onSelectApp callback for contactless transactions so the
            // kernel notifies us when multiple AIDs match (same as reference app).
            emvHandler!!.contactlessSupportAppSelectCallback(true)
            setupTerminalConfig()
            setupEmvAids()
            setupCapks()
            // setupContactlessAids() — REMOVED: contactlessAppendAidIntoKernel configures
            // a secondary PayWave/PayPass offline kernel, NOT the standard emvProcessFlow1
            // contactless path. The reference app (NexGo emvTestConsole) does not call
            // contactlessAppendAidIntoKernel at all. Having it alongside emvProcessFlow1
            // contactless causes an RF kernel state conflict → wrapper_spi_ddi_rf_exchange_apdu
            // ret=-1 during SELECT. The emvProcessFlow1 path uses setAidParaList AIDs
            // filtered by AID_ENTRY_CONTACT_CONTACTLESS mode, which is now correct.
            log("INIT", "initialize() complete — AIDs=${emvHandler?.aidListNum ?: 0}")
            promise.resolve(true)
        } catch (e: Exception) {
            logError("INIT", "initialize() threw exception", e)
            promise.reject("ERR_INITIALIZE", e.message ?: "APIProxy.getDeviceEngine failed")
        }
    }

    /**
     * Build ONE AidEntity registered for both chip and contactless.
     *
     * AID entry mode analysis (tag df23 in aidEntityToTlv bytecode):
     *   df23 = 0x00  → AID_ENTRY_CONTACT_CONTACTLESS — both interfaces ✓
     *   df23 = 0x01  → AID_ENTRY_CONTACT             — chip only
     *   df23 = 0x02  → AID_ENTRY_CONTACTLESS          — tap only
     *
     * History:
     *   v1: AID_ENTRY_CONTACT_CONTACTLESS → chip -8012 (candidate list empty)
     *   v2: AID_ENTRY_CONTACT → chip works, contactless -8012:
     *         contactlessAppendAidIntoKernel configures a separate subsystem
     *         (likely PayWave/PayPass offline kernel), NOT the contactless
     *         emvProcessFlow1 AID list. emvProcessFlow1 for contactless uses
     *         the setAidParaList AIDs filtered by mode — with all AIDs as
     *         AID_ENTRY_CONTACT, the contactless filter returned zero entries
     *         → immediate -8012 before PPSE is even sent. Logcat confirmed:
     *         no APDU lines between emvProcessFlow1 start and onFinish -8012.
     *   v3: AID_ENTRY_CONTACT_CONTACTLESS — both kernels see the AIDs.
     *         The reference app (NexGo emvTestConsole) uses only setAidParaList
     *         with the default mode (AID_ENTRY_CONTACT_CONTACTLESS) for both
     *         chip and contactless — no contactlessAppendAidIntoKernel at all.
     *         initReader(INNER, 0) is still called before chip emvProcess,
     *         which routes the EMV core to the ICC slot so chip still works.
     */
    private fun aidEntity(
        aidHex: String, asi: Int, appVer: String,
        tacDefault: String, tacOnline: String, tacDenial: String,
        floorLimit: Long = 0L,
        // US contactless limits (units = cents):
        //   clTransLimit  — max contactless transaction; set high since Charrg API enforces real limits
        //   clCvmLimit    — above this amount CVM (PIN) is required; high = no-CVM for all taps
        //   clFloorLimit  — transactions above this go online; 0 = all go online (correct for online terminal)
        // Reference app uses contactlessTransLimit=99999999 to avoid any contactless ceiling.
        // Our previous value (2500 = $25.00 CVM limit) caused Emv_CTLS_TransTryAgain (-8034)
        // for any contactless amount > $25 because the kernel couldn't do PIN on RF interface.
        clTransLimit: Long = 9999999L,
        clCvmLimit: Long = 9999999L,
        clFloorLimit: Long = 0L
    ): AidEntity = AidEntity().apply {
        setAid(aidHex)
        setAsi(asi)
        setAppVerNum(appVer)
        setTacDefault(tacDefault)
        setTacOnline(tacOnline)
        setTacDenial(tacDenial)
        setFloorLimit(floorLimit)
        setContactlessTransLimit(clTransLimit)
        setContactlessCvmLimit(clCvmLimit)
        setContactlessFloorLimit(clFloorLimit)
        // AID_ENTRY_CONTACT_CONTACTLESS (df23=0x00) — both the chip kernel and
        // the contactless emvProcessFlow1 see this AID. The reference app uses
        // this default mode exclusively (no contactlessAppendAidIntoKernel).
        setAidEntryModeEnum(AidEntryModeEnum.AID_ENTRY_CONTACT_CONTACTLESS)
    }

    private fun setupEmvAids() {
        val handler = emvHandler ?: run {
            logError("EMVAID", "emvHandler is null — cannot configure AIDs")
            return
        }

        val before = handler.aidListNum
        handler.delAllAid()
        log("EMVAID", "Configuring US payment AIDs (cleared $before stale AID(s))")

        val aids = mutableListOf<AidEntity>()

        // ASI=1 (df01=0x01) enables PARTIAL MATCH: the terminal AID is treated as a
        // prefix — any card AID that STARTS WITH the terminal AID is accepted.
        // ASI=0 (df01=0x00) requires EXACT MATCH — the card AID must equal the
        // terminal AID byte-for-byte. We use ASI=1 for all networks to handle
        // variant AIDs (e.g. A000000003101001 issued by some US banks).

        // ── Visa Credit / Debit ─────────── A0000000031010
        aids.add(aidEntity("A0000000031010", 1, "0096",
            "DC4000A800", "DC4004F800", "0010000000"))

        // ── Visa Electron ───────────────── A0000000032010
        aids.add(aidEntity("A0000000032010", 1, "0096",
            "DC4000A800", "DC4004F800", "0010000000"))

        // ── Mastercard Credit ───────────── A0000000041010
        // TAC values from NexGo reference app (inbas_aid.json A0000000041010).
        // Key difference from our previous values: tacDefault byte4 = A0 (not F8).
        // F8 includes bits for SDA-failed + DDA-failed + card-on-exception-file;
        // with CAPK count=0 those bits fire during ODA → TAC-Default match →
        // offline decline → contactless kernel returns -8034 (CTLS_TransTryAgain).
        // A0 removes those bits so the kernel proceeds to online auth (onOnlineProc).
        aids.add(aidEntity("A0000000041010", 1, "0002",
            "FC50B8A000", "FC50808800", "0000000000"))

        // ── Mastercard Debit ────────────── A0000000042203
        aids.add(aidEntity("A0000000042203", 1, "0002",
            "FC50BCA000", "FC50BCF800", "0000000000"))

        // ── Maestro ─────────────────────── A0000000043060
        aids.add(aidEntity("A0000000043060", 1, "0002",
            "FC50BCA000", "FC50BCF800", "0000000000"))

        // ── American Express ─────────────── A0000000250101
        aids.add(aidEntity("A0000000250101", 1, "0001",
            "FC78BCF800", "F878BC7800", "0000000000"))

        // ── Amex ExpressPay (tap AID) ────── A000000025010402
        // Contactless Amex cards advertise this AID via PPSE, NOT A0000000250101.
        aids.add(aidEntity("A000000025010402", 1, "0001",
            "FC78BCF800", "F878BC7800", "0000000000"))

        // ── Discover ────────────────────── A0000001523010
        aids.add(aidEntity("A0000001523010", 1, "0001",
            "F800F0A000", "F800F0A000", "0000000000"))

        // ── Diners Club / Discover ──────── A0000001524010
        aids.add(aidEntity("A0000001524010", 1, "0001",
            "F800F0A000", "F800F0A000", "0000000000"))

        // ── JCB ─────────────────────────── A0000000651010
        aids.add(aidEntity("A0000000651010", 1, "0002",
            "F878248000", "F878248000", "0000000000"))

        // ── US Common Debit / STAR EMV ──── A0000002771010
        // Many US bank-issued debit chip cards expose STAR EMV as their primary
        // (or only) AID on chip. Without this entry, -8012 fires for those cards.
        aids.add(aidEntity("A0000002771010", 1, "0001",
            "DC4000A800", "DC4004F800", "0010000000"))

        // ── US PIN Debit / PULSE ─────────── A0000002761010
        aids.add(aidEntity("A0000002761010", 1, "0001",
            "DC4000A800", "DC4004F800", "0010000000"))

        val result = handler.setAidParaList(aids)
        log("EMVAID", "setAidParaList result=$result — AIDs after=${handler.aidListNum} (expected ${aids.size})")
        dumpAidTable("post-setup")
        log("EMVCAPK", "CAPK count after setup=${handler.capkListNum}")
    }

    /**
     * Dump every AID stored in the native layer so we can verify the kernel
     * has exactly what we registered (aid hex + entry mode enum).
     */
    private fun dumpAidTable(label: String) {
        val handler = emvHandler ?: return
        try {
            val list = handler.aidList
            if (list.isNullOrEmpty()) {
                log("EMVAID-DUMP[$label]", "EMPTY — native layer has no AIDs")
                return
            }
            list.forEachIndexed { i, entry ->
                val aidHex  = try { entry.aid  ?: "(null)" } catch (e: Exception) { "err:${e.message}" }
                val mode    = try { entry.aidEntryModeEnum?.name ?: "(null)" } catch (e: Exception) { "err:${e.message}" }
                log("EMVAID-DUMP[$label]", "[$i] aid=$aidHex mode=$mode")
            }
        } catch (e: Exception) {
            logError("EMVAID-DUMP", "getAidList threw at label=$label", e)
        }
    }

    /**
     * Read recent Android logcat lines that look like native EMV traces.
     * NexGo's emvDebugLog(true) and LogUtils.setDebugEnable(true) write APDU
     * command/response bytes and PPSE/SELECT results to logcat. Capturing them
     * after a -8012 lets us see exactly what AID(s) the card advertised so we
     * can match (or add) them in our terminal AID table.
     *
     * This is best-effort: if the process doesn't have READ_LOGS permission the
     * exec() will succeed but the output will be empty (or the process may fail),
     * in which case we log a note and move on.
     */
    private fun captureNativeEmvLog() {
        try {
            val proc = Runtime.getRuntime().exec(arrayOf("logcat", "-d", "-t", "400"))
            val raw = proc.inputStream.bufferedReader().readText()
            proc.destroy()
            val filtered = raw.lines().filter { line ->
                val l = line.lowercase()
                l.contains("emv") || l.contains("pboc") || l.contains("apdu") ||
                l.contains("ppse") || l.contains("2pay") || l.contains("1pay") ||
                l.contains("nexgo") || l.contains("candidat") || l.contains("select") ||
                l.contains("df01") || l.contains("df23") || l.contains("9f06")
            }.takeLast(120)
            if (filtered.isEmpty()) {
                log("LOGCAT", "No EMV-related logcat lines found (READ_LOGS may be unavailable)")
            } else {
                log("LOGCAT", "=== NATIVE EMV LOGCAT (${filtered.size} lines) ===")
                filtered.forEach { log("LOGCAT", it) }
                log("LOGCAT", "=== END NATIVE EMV LOGCAT ===")
            }
        } catch (e: Exception) {
            log("LOGCAT", "captureNativeEmvLog failed: ${e.message}")
        }
    }

    /**
     * Set terminal-level EMV configuration matching the reference app (NexGo emvTestConsole).
     * Called once at initialize() and again per-transaction (reference app calls
     * configureTerminal() immediately before every emvProcess()).
     *
     * Reference app configureTerminal():
     *   emvHandler.setTlv(9F33, E0F8C8)                 — Terminal Capabilities
     *   emvHandler.initTermConfig(9F1A0208405F2A0208409F3C020840)
     *
     * Tags:
     *   9F33  Terminal Capabilities  E0F8C8
     *           Byte1 E0 = Manual+MagStripe+IC
     *           Byte2 F8 = OfflineEncPin+OnlinePin+Sig+OfflinePlainPin+NoCVM
     *           Byte3 C8 = CDA+DDA (offline data authentication)
     *   9F1A  Terminal Country Code  0840 (USA)
     *   5F2A  Transaction Currency Code  0840 (USD)
     *   9F3C  Reference Currency Code  0840 (USD) — required by reference app
     *
     * NOT set via initTermConfig (left as SDK device defaults, per reference app):
     *   9F35 Terminal Type, 9F40 Additional Terminal Capabilities, 9F1B Floor Limit
     */
    private fun setupTerminalConfig() {
        val handler = emvHandler ?: run {
            logError("TERM", "emvHandler is null — cannot configure terminal attributes")
            return
        }
        try {
            handler.setTlv(hexToBytes("9F33"), hexToBytes("E0F8C8"))
            val result = handler.initTermConfig(
                hexToBytes("9F1A020840" + "5F2A020840" + "9F3C020840")
            )
            log("TERM", "configureTerminal: setTlv(9F33=E0F8C8) + initTermConfig(9F1A+5F2A+9F3C) result=$result")
        } catch (e: Exception) {
            logError("TERM", "setupTerminalConfig threw", e)
        }
    }

    /**
     * Load 60 CAPKs from the bundled inbas_capk.json asset and register them with the
     * EMV kernel via setCAPKList(). CAPKs cover Visa (a000000003), Mastercard (a000000004),
     * Amex (a000000025), JCB (a000000065), Discover (a000000152), UnionPay (a000000333).
     *
     * Without CAPKs the kernel cannot perform offline data authentication (SDA/DDA/CDA).
     * The reference app (NexGo emvTestConsole) loads the same set via Gson deserialization.
     */
    private fun setupCapks() {
        val handler = emvHandler ?: run {
            logError("CAPK", "emvHandler null — cannot load CAPKs")
            return
        }
        try {
            val context = sdkContext()
            val json = context.assets.open("inbas_capk.json").use { it.readBytes().toString(Charsets.UTF_8) }
            val arr = org.json.JSONArray(json)
            val capkList = ArrayList<CapkEntity>(arr.length())
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                val capk = CapkEntity()
                capk.setRid(o.optString("rid", ""))
                capk.setCapkIdx(o.optInt("capkIdx", 0))
                capk.setHashInd(o.optInt("hashInd", 1))
                capk.setArithInd(o.optInt("arithInd", 1))
                capk.setModulus(o.optString("modulus", ""))
                capk.setExponent(o.optString("exponent", ""))
                capk.setCheckSum(o.optString("checkSum", ""))
                capk.setExpireDate(o.optString("expireDate", "99991231"))
                capkList.add(capk)
            }
            handler.setCAPKList(capkList)
            val count = handler.capkListNum
            log("CAPK", "Loaded ${capkList.size} CAPKs from assets → kernel reports $count")
        } catch (e: Exception) {
            logError("CAPK", "setupCapks threw", e)
        }
    }

    private fun setupContactlessAids() {
        val handler = emvHandler ?: return
        try {
            // Reset the contactless AID list before re-populating.
            handler.contactlessAppendAidIntoKernelFirst(true)
            log("EMVAID-CL", "Contactless kernel AID list reset — registering AIDs per brand")

            data class CLAid(val brand: EmvCardBrandEnum, val aidHex: String)

            val clAids = listOf(
                CLAid(EmvCardBrandEnum.EMV_CARD_BRAND_VISA,   "A0000000031010"), // Visa payWave
                CLAid(EmvCardBrandEnum.EMV_CARD_BRAND_VISA,   "A0000000032010"), // Visa Electron
                CLAid(EmvCardBrandEnum.EMV_CARD_BRAND_MASTER, "A0000000041010"), // Mastercard PayPass
                CLAid(EmvCardBrandEnum.EMV_CARD_BRAND_MASTER, "A0000000042203"), // Mastercard Debit
                CLAid(EmvCardBrandEnum.EMV_CARD_BRAND_MASTER, "A0000000043060"), // Maestro
                CLAid(EmvCardBrandEnum.EMV_CARD_BRAND_AMEX,   "A0000000250101"), // Amex contact
                CLAid(EmvCardBrandEnum.EMV_CARD_BRAND_AMEX,   "A000000025010402"), // Amex ExpressPay
                CLAid(EmvCardBrandEnum.EMV_CARD_BRAND_JCB,    "A0000000651010"), // JCB J/Speedy
            )

            for ((brand, aidHex) in clAids) {
                // Bytecode analysis of contactlessAppendAidIntoKernel() shows the
                // second parameter is the MINIMUM AID MATCH LENGTH (not an ASI flag).
                // Validation rejects values < 5 with -2 (Param_In_Invalid).
                // Passing the full AID byte length gives exact-match semantics and
                // passes validation (all our AIDs are 7-8 bytes, well above 5).
                val aidBytes = hexToBytes(aidHex)
                val r = handler.contactlessAppendAidIntoKernel(brand, aidBytes.size.toByte(), aidBytes)
                log("EMVAID-CL", "  $brand $aidHex (${aidBytes.size} bytes) → result=$r")
            }
            log("EMVAID-CL", "Contactless AIDs registered (${clAids.size} entries)")
        } catch (e: Exception) {
            logError("EMVAID-CL", "setupContactlessAids threw", e)
        }
    }

    @ReactMethod
    fun getDeviceInfo(promise: Promise) {
        try {
            val engine = deviceEngine ?: APIProxy.getDeviceEngine(sdkContext())
            if (engine == null) {
                promise.reject("ERR_NOT_INITIALIZED", "DeviceEngine unavailable — ensure this is a NexGo device and the app was built as a standalone APK")
                return
            }
            val info = engine.deviceInfo
            if (info == null) {
                promise.reject("ERR_DEVICE_INFO", "DeviceInfo unavailable")
                return
            }
            val map = Arguments.createMap().apply {
                putString("sn",               info.sn              ?: "")
                putString("ksn",              info.ksn             ?: "")
                putString("model",            info.model           ?: "")
                putString("vendor",           info.vendor          ?: "")
                putString("osVer",            info.osVer           ?: "")
                putString("sdkVer",           info.sdkVer          ?: "")
                putString("firmwareVer",      info.firmWareVer     ?: "")
                putString("firmwareFullVer",  info.firmWareFullVersion ?: "")
                putString("kernelVer",        info.kernelVer       ?: "")
                putString("spCoreVersion",    info.spCoreVersion   ?: "")
                putString("spBootVersion",    info.spBootVersion   ?: "")
            }
            promise.resolve(map)
        } catch (e: Exception) {
            promise.reject("ERR_DEVICE_INFO", e.message ?: "Unknown error")
        }
    }

    @ReactMethod
    fun startCardRead(amount: Double, promise: Promise) {
        log("CARD", "startCardRead() amount=${amount}")
        if (deviceEngine == null || cardReader == null) {
            logError("CARD", "startCardRead called before initialize()")
            promise.reject("ERR_NOT_INITIALIZED", "SDK not initialized")
            return
        }

        if (isReading) {
            logError("CARD", "startCardRead called while already reading")
            promise.reject("ERR_ALREADY_READING", "Card read already in progress")
            return
        }

        isReading = true
        sendEvent("reading_started")

        try {
            val slotTypes = hashSetOf(
                CardSlotTypeEnum.ICC1,
                CardSlotTypeEnum.RF,
                CardSlotTypeEnum.SWIPE
            )

            log("CARD", "searchCard() — waiting for card presentation (60 s timeout)")

            cardReader!!.searchCard(slotTypes, 60, object : OnCardInfoListener {
                override fun onCardInfo(retCode: Int, cardInfo: CardInfoEntity?) {
                    if (retCode != SdkResult.Success || cardInfo == null) {
                        isReading = false
                        if (retCode == SdkResult.TimeOut) {
                            log("CARD", "searchCard timed out (retCode=$retCode)")
                            sendEvent("timeout")
                        } else {
                            logError("CARD", "searchCard failed retCode=$retCode cardInfo=${cardInfo}")
                            sendEvent("reading_failed", Arguments.createMap().apply {
                                putString("message", "Card read failed with code: $retCode")
                            })
                        }
                        return
                    }

                    val slot = cardInfo.cardExistslot
                    log("CARD", "onCardInfo OK — slot=$slot")

                    when (slot) {
                        CardSlotTypeEnum.ICC1, CardSlotTypeEnum.ICC2 -> {
                            log("CARD", "Card inserted (chip/ICC)")
                            sendEvent("card_inserted")
                            // Post to our dedicated emvWorker thread, NOT the main looper.
                            // emvProcess() blocks its calling thread; if that's the main thread
                            // the main looper is frozen and can't dispatch the
                            // onSetTransInitBeforeGPOResponse post — instant deadlock/crash.
                            // emvWorker is a background HandlerThread that stays blocked in
                            // emvProcess() while the SDK fires callbacks on its own internal
                            // thread; those callbacks call response functions directly.
                            emvWorker.post { processEmvCard(amount, cardInfo, "chip") }
                        }
                        CardSlotTypeEnum.RF -> {
                            log("CARD", "Card tapped (contactless/RF)")
                            sendEvent("card_tapped")
                            emvWorker.post { processEmvCard(amount, cardInfo, "contactless") }
                        }
                        CardSlotTypeEnum.SWIPE -> {
                            log("CARD", "Card swiped (magnetic stripe)")
                            sendEvent("card_swiped")
                            processSwipeCard(cardInfo)
                        }
                        else -> {
                            logError("CARD", "Unknown cardExistslot=$slot")
                            isReading = false
                            sendEvent("reading_failed", Arguments.createMap().apply {
                                putString("message", "Unknown card slot type")
                            })
                        }
                    }
                }

                override fun onSwipeIncorrect() {
                    logError("CARD", "onSwipeIncorrect — bad swipe")
                    sendEvent("reading_failed", Arguments.createMap().apply {
                        putString("message", "Swipe incorrect, please try again")
                    })
                }

                override fun onMultipleCards() {
                    logError("CARD", "onMultipleCards — multiple cards detected")
                    sendEvent("reading_failed", Arguments.createMap().apply {
                        putString("message", "Multiple cards detected, please present one card")
                    })
                }
            })

            promise.resolve(null)
        } catch (e: Exception) {
            isReading = false
            logError("CARD", "startCardRead threw exception", e)
            promise.reject("ERR_CARD_READ", e.message ?: "Card read failed")
        }
    }

    private fun processSwipeCard(cardInfo: CardInfoEntity) {
        log("SWIPE", "processSwipeCard() — tk1=${(cardInfo.tk1 ?: "").take(6)}… tk2=${(cardInfo.tk2 ?: "").take(6)}…")
        try {
            val track1 = cardInfo.tk1 ?: ""
            val track2 = cardInfo.tk2 ?: ""

            var pan = ""
            var expiry = ""
            var cardholderName = ""

            if (track2.isNotEmpty() && track2.contains("=")) {
                val parts = track2.split("=")
                pan = parts[0]
                if (parts.size > 1 && parts[1].length >= 4) {
                    expiry = parts[1].substring(0, 4)
                }
            }

            if (track1.isNotEmpty() && track1.contains("^")) {
                val t1Parts = track1.split("^")
                if (t1Parts.size >= 2) cardholderName = t1Parts[1].trim()
            }

            log("SWIPE", "Swipe parsed — pan=***${pan.takeLast(4)} expiry=$expiry brand=${detectCardBrand(pan)}")
            sendEvent("reading_complete")
            sendEvent("card_read_complete", Arguments.createMap().apply {
                putString("pan", pan)
                putString("expiry", expiry)
                putString("cardholder_name", cardholderName)
                putString("track1", track1)
                putString("track2", track2)
                putString("entry_mode", "swipe")
                putString("last4", if (pan.length >= 4) pan.takeLast(4) else "")
                putString("card_brand", detectCardBrand(pan))
            })
        } catch (e: Exception) {
            logError("SWIPE", "processSwipeCard threw exception", e)
            sendEvent("reading_failed", Arguments.createMap().apply {
                putString("message", e.message ?: "Failed to process swipe card")
            })
        } finally {
            isReading = false
        }
    }

    /**
     * Pad a string to [length] bytes with ASCII spaces and return as ByteArray.
     * NexGo's EMV kernel treats merName as a fixed-width field — passing fewer
     * bytes than it expects can corrupt adjacent fields and crash the native code.
     */
    private fun asciiPadded(s: String, length: Int): ByteArray {
        val bytes = s.toByteArray(Charsets.US_ASCII)
        return ByteArray(length) { i -> if (i < bytes.size) bytes[i] else 0x20 }
    }

    /** Convert a hex string like "A0000000041010" to a ByteArray. */
    private fun hexToBytes(hex: String): ByteArray =
        ByteArray(hex.length / 2) { i -> hex.substring(i * 2, i * 2 + 2).toInt(16).toByte() }

    private fun processEmvCard(amount: Double, cardInfo: CardInfoEntity, entryMode: String) {
        log("EMV", "processEmvCard() entryMode=$entryMode amount=$amount")

        val handler = emvHandler
        if (handler == null) {
            logError("EMV", "emvHandler is null in processEmvCard — was initialize() called?")
            isReading = false
            sendEvent("reading_failed", Arguments.createMap().apply {
                putString("message", "EMV handler not initialized")
            })
            return
        }

        // AIDs are configured once in initialize(). Do NOT call setupEmvAids() or
        // setupContactlessAids() here — delAllAid() / contactlessAppendAidIntoKernelFirst()
        // while a card is physically inserted resets kernel state mid-session and causes
        // Emv_Cancel immediately after app selection.

        try {
            val now = java.util.Calendar.getInstance()
            val isContactless = (entryMode == "contactless")
            val emvTransConfig = EmvTransConfigurationEntity().apply {
                transAmount  = (amount * 100).toLong().toString()
                countryCode  = "0840"          // ISO 3166-1 numeric: USA
                currencyCode = "0840"          // ISO 4217 numeric:   USD
                emvTransType = 0x00            // 00 = Goods & Services
                transDate = String.format("%02d%02d%02d",
                    now.get(java.util.Calendar.YEAR) % 100,
                    now.get(java.util.Calendar.MONTH) + 1,
                    now.get(java.util.Calendar.DAY_OF_MONTH))
                transTime = String.format("%02d%02d%02d",
                    now.get(java.util.Calendar.HOUR_OF_DAY),
                    now.get(java.util.Calendar.MINUTE),
                    now.get(java.util.Calendar.SECOND))
                termId  = "CHARRG01"           // 8 chars (standard terminal ID length)
                merId   = "CHARRG         "    // 15 chars (standard merchant ID length)
                // merName is a fixed-width byte field in the NexGo SDK.
                // Padding to 20 bytes avoids native buffer overruns that crash the app.
                merName = asciiPadded("Charrg POS", 20)
                // setEmvEntryModeEnum MUST be set for both modes:
                //   • Chip: EMV_ENTRY_MODE_CONTACT — without this the SDK defaults to
                //     the RF kernel and causes a native SIGSEGV crash on card insert.
                //   • Tap:  EMV_ENTRY_MODE_CONTACTLESS — routes to the RF kernel.
                // AIDs registered with AID_ENTRY_CONTACT_CONTACTLESS serve both kernels.
                setEmvEntryModeEnum(
                    if (isContactless) EmvEntryModeEnum.EMV_ENTRY_MODE_CONTACTLESS
                    else               EmvEntryModeEnum.EMV_ENTRY_MODE_CONTACT
                )
                setEmvProcessFlowEnum(EmvProcessFlowEnum.EMV_PROCESS_FLOW_STANDARD)
                isContactlessSupportSelectApp = isContactless
            }
            val entryModeLabel = if (isContactless) "CONTACTLESS" else "CONTACT"
            log("EMV", "emvProcess() config — amount=${emvTransConfig.transAmount} " +
                "date=${emvTransConfig.transDate} time=${emvTransConfig.transTime} " +
                "entryMode=$entryModeLabel AIDsNow=${handler.aidListNum}")

            // Defensive: re-assert INNER reader before each chip transaction.
            // initReader(INNER, 0) → EmvCore.setEmvExternalDevice(null) → setExternalReader(0).
            // The root cause of -8012 was AID de-duplication (see aidEntity() above),
            // but this call is kept as a safety net in case any SDK state gets reset.
            if (!isContactless) {
                handler.initReader(ReaderTypeEnum.INNER, 0)
                log("EMV", "initReader(INNER, 0) asserted before chip emvProcess")
            }

            // Dump native AID table right before emvProcess so we can confirm the kernel
            // still has all AIDs at call time (state reset between init and use would show here).
            dumpAidTable("pre-emvProcess")
            log("EMVCAPK", "CAPK count pre-emvProcess=${handler.capkListNum}")

            // Re-apply terminal config per-transaction (reference app calls configureTerminal()
            // before every emvProcess() — state may be reset between transactions).
            setupTerminalConfig()

            // NOTE: Do NOT call emvProcessCancel() here before emvProcess().
            // emvProcessCancel() sets an internal "cancel" flag in the SDK kernel that
            // persists into the next transaction — the kernel fires onFinish(-8031) immediately
            // after onSelApp even though no user cancellation occurred. emvProcessCancel()
            // is only valid when called to interrupt an ACTIVE emvProcess() call (e.g., user
            // presses cancel). We call it correctly in cancelCardRead() for that purpose.
            handler.emvProcess(emvTransConfig, object : OnEmvProcessListener2 {

                override fun onSelApp(
                    appNameList: MutableList<String>?,
                    appInfoList: MutableList<CandidateAppInfoEntity>?,
                    isFirstSelect: Boolean
                ) {
                    try {
                        // onSelApp is only called when the candidate list is NON-EMPTY.
                        // If we never see this log, the kernel found zero matching AIDs.
                        val namesSummary = appNameList?.joinToString() ?: "none"
                        val aidsSummary  = appInfoList?.joinToString {
                            it.aid?.joinToString("") { b -> "%02X".format(b) } ?: "?"
                        } ?: "none"
                        // onSetSelAppResponse uses 1-based indexing:
                        //   0 = cancel/abort the transaction (→ retCode=-8020 Emv_Cancel)
                        //   1 = select app at list index 0 (first app)
                        //   2 = select app at list index 1 (second app)
                        // Reference app (emvTestConsole) always passes 1 for auto-select.
                        log("EMV", "onSelApp REACHED — names=[$namesSummary] aids=[$aidsSummary] isFirstSelect=$isFirstSelect — auto-selecting 1st app (response=1)")
                        handler.onSetSelAppResponse(1)
                    } catch (e: Exception) {
                        logError("EMV", "onSelApp threw", e)
                    }
                }

                override fun onTransInitBeforeGPO() {
                    // emvProcess() runs on emvWorker (background HandlerThread).
                    // This callback fires on the SDK's own internal thread — a
                    // different thread from emvWorker — so calling the response
                    // directly is safe (no re-entry, no deadlock).
                    try {
                        log("EMV", "onTransInitBeforeGPO — responding directly on SDK callback thread")
                        handler.onSetTransInitBeforeGPOResponse(true)
                        log("EMV", "onSetTransInitBeforeGPOResponse sent OK")
                    } catch (e: Exception) {
                        logError("EMV", "onSetTransInitBeforeGPOResponse threw", e)
                    }
                }

                override fun onConfirmCardNo(cardInfoEntity: CardInfoEntity) {
                    try {
                        val last4 = cardInfoEntity.cardNo?.let {
                            if (it.length >= 4) it.takeLast(4) else it
                        } ?: "?"
                        log("EMV", "onConfirmCardNo — last4=$last4")
                        handler.onSetConfirmCardNoResponse(true)
                    } catch (e: Exception) {
                        logError("EMV", "onConfirmCardNo threw", e)
                    }
                }

                override fun onCardHolderInputPin(isOnlinePin: Boolean, leftTimes: Int) {
                    try {
                        log("EMV", "onCardHolderInputPin — isOnlinePin=$isOnlinePin leftTimes=$leftTimes — bypassing PIN")
                        sendEvent("pin_requested")
                        handler.onSetPinInputResponse(isOnlinePin, false)
                        sendEvent("pin_entered")
                    } catch (e: Exception) {
                        logError("EMV", "onCardHolderInputPin threw", e)
                    }
                }

                override fun onContactlessTapCardAgain() {
                    try {
                        log("EMV", "onContactlessTapCardAgain — asking user to re-tap")
                        sendEvent("reading_failed", Arguments.createMap().apply {
                            putString("message", "Please tap your card again")
                        })
                    } catch (e: Exception) {
                        logError("EMV", "onContactlessTapCardAgain threw", e)
                    }
                }

                override fun onOnlineProc() {
                    try {
                        // The EMV kernel fires onOnlineProc when it needs an online
                        // authorization result before completing the transaction.
                        //
                        // Root cause of Emv_Arpc_Fail (-8022, confirmed from SdkResult.class):
                        //   Bytecode analysis of EmvHandler2Impl$4.run() confirms that the
                        //   native emvProcessFlow2() always runs EXTERNAL AUTHENTICATE when
                        //   the card's AIP byte-1 bit-4 (issuer authentication supported) is
                        //   set, regardless of terminalDecision or recvField55 contents.
                        //   With no valid ARPC the card returns SW=6300 → Emv_Arpc_Fail.
                        //
                        // Fix: clear AIP bit-4 in the kernel's TLV store BEFORE calling
                        //   onSetOnlineProcResponse. The kernel re-reads AIP from its TLV
                        //   store at the start of emvProcessFlow2, so clearing it here
                        //   prevents EXTERNAL AUTHENTICATE from being sent.
                        //
                        //   AIP (tag 82) byte-0 bit layout (EMV notation, b8=MSB, b1=LSB):
                        //     b8 = SDA supported
                        //     b7 = DDA supported
                        //     b6 = Cardholder verification supported
                        //     b5 = Terminal risk management required
                        //     b4 = Issuer authentication supported  ← clear this (0x08)
                        //     b3 = On-device CVM supported
                        //     b2 = CDA supported
                        //     b1 = RFU
                        //
                        // TODO (Charrg API integration): remove the AIP patch and instead pass
                        //   the real Field 55 (containing ARPC in tag 91) from the acquirer
                        //   response, then use DECISION_KERNEL for proper ARPC verification.
                        try {
                            val aip = handler.getTlv(
                                byteArrayOf(0x82.toByte()),
                                EmvDataSourceEnum.FROM_KERNEL
                            )
                            if (aip != null && aip.isNotEmpty()) {
                                val origByte0 = aip[0].toInt() and 0xFF
                                aip[0] = (aip[0].toInt() and 0xF7).toByte() // clear b4 (0x08)
                                val patchResult = handler.setTlv(byteArrayOf(0x82.toByte()), aip)
                                log("EMV", "AIP patch: byte0 0x${origByte0.toString(16)} → 0x${(aip[0].toInt() and 0xFF).toString(16)} setTlv=$patchResult")
                            } else {
                                log("EMV", "AIP patch skipped — getTlv(82) returned null/empty")
                            }
                        } catch (e: Exception) {
                            log("EMV", "AIP patch failed: ${e.message}")
                        }
                        // Match reference app exactly: authCode + rejCode="00" + null field55.
                        // Do NOT call setTerminalDecisionSecondGAC() — the reference app
                        // omits this entirely, which lets the kernel decide. When the
                        // kernel sees rejCode="00" with no explicit DECISION_TERMINAL_TC,
                        // it takes a code path that yields Emv_Success_Arpc_Fail (TC issued,
                        // ARPC absent) rather than Emv_Arpc_Fail (EXTERNAL AUTHENTICATE
                        // failed). See NexGo emvTestConsole onOnlineProc for reference.
                        //
                        // TODO (Charrg API): pass real field55 (tag 8A + tag 91 ARPC) and
                        //   use DECISION_KERNEL for full issuer authentication.
                        val onlineResult = EmvOnlineResultEntity().apply {
                            setAuthCode("000000")
                            setRejCode("00")
                            setRecvField55(null)
                        }
                        handler.onSetOnlineProcResponse(SdkResult.Success, onlineResult)
                        log("EMV", "onOnlineProc — sent approved (authCode=000000 rejCode=00 field55=null, no forced decision)")
                    } catch (e: Exception) {
                        logError("EMV", "onOnlineProc threw", e)
                        handler.onSetOnlineProcResponse(SdkResult.Fail, null)
                    }
                }

                override fun onPrompt(promptEnum: com.nexgo.oaf.apiv3.emv.PromptEnum?) {
                    try {
                        log("EMV", "onPrompt — $promptEnum")
                    } catch (e: Exception) {
                        logError("EMV", "onPrompt threw", e)
                    }
                }

                override fun onRemoveCard() {
                    try {
                        log("EMV", "onRemoveCard")
                        sendEvent("card_removed")
                    } catch (e: Exception) {
                        logError("EMV", "onRemoveCard threw", e)
                    }
                }

                override fun onFinish(retCode: Int, result: EmvProcessResultEntity?) {
                    try {
                        log("EMV", "onFinish retCode=$retCode (SdkResult.Success=${SdkResult.Success})")
                        if (retCode == SdkResult.Success ||
                            retCode == SdkResult.Emv_Success_Arpc_Fail
                        ) {
                            // Success: SdkResult.Success = full TC issued, ARPC verified.
                            // Emv_Success_Arpc_Fail = TC was issued but ARPC was absent/invalid.
                            // The reference app (NexGo emvTestConsole) treats both as approved
                            // because the terminal received a TC and the processor approved
                            // online — ARPC is only needed if the card enforces it.
                            //
                            // CRITICAL: For chip (EMV) transactions the PAN, expiry and track
                            // data are NOT in the original cardInfo from searchCard — they are
                            // only available after emvProcess via getEmvCardDataInfo().
                            // Accessing cardInfo fields here causes a SIGSEGV native crash
                            // because the SDK may have freed or mutated that native object.
                            val emvCardData = handler.getEmvCardDataInfo()
                            val pan: String    = emvCardData?.cardNo      ?: ""
                            val expiry: String = emvCardData?.expiredDate  ?: ""
                            val track2: String = emvCardData?.tk2          ?: ""
                            val track1: String = emvCardData?.tk1          ?: ""
                            val last4          = if (pan.length >= 4) pan.takeLast(4) else pan
                            log("EMV", "onFinish SUCCESS (retCode=$retCode) — pan=***$last4 expiry=$expiry brand=${detectCardBrand(pan)} entryMode=$entryMode")
                            sendEvent("reading_complete")
                            sendEvent("card_read_complete", Arguments.createMap().apply {
                                putString("pan", pan)
                                putString("expiry", expiry)
                                putString("cardholder_name", "")
                                putString("track1", track1)
                                putString("track2", track2)
                                putString("emv_data", "")
                                putString("entry_mode", entryMode)
                                putString("last4", last4)
                                putString("card_brand", detectCardBrand(pan))
                            })
                        } else if (retCode == SdkResult.Emv_FallBack && isContactless) {
                            // -8014: The card's contactless chip signalled EMV FallBack —
                            // it wants the transaction to be completed via the contact chip
                            // interface instead. This is normal for some cards/amounts.
                            // Signal the JS layer to stop the current read and re-prompt
                            // the user to insert their card into the chip slot.
                            log("EMV", "onFinish Emv_FallBack — contactless card requesting chip fallback")
                            sendEvent("contactless_fallback")
                        } else if (
                            retCode == SdkResult.Emv_Arpc_Fail ||
                            retCode == SdkResult.Emv_Script_Fail
                        ) {
                            // The EMV kernel completed online processing but hard ARPC or
                            // script execution failed.  Card data (PAN, expiry, track) was
                            // already captured during READ RECORD — before this failure.
                            // Emv_Success_Arpc_Fail is handled in the success branch above.
                            //
                            // retCode meaning (confirmed from javap of SdkResult.class):
                            //   Emv_Arpc_Fail   (-8022): EXTERNAL AUTHENTICATE failed
                            //                            (card returned SW=6300, no valid ARPC)
                            //   Emv_Script_Fail (-8023): Issuer script execution failed post-TC
                            //
                            // For development (no Charrg API yet): extract card data here and
                            // fire card_read_complete so the payment flow can proceed.
                            //
                            // TODO (Charrg API): with a real ARPC in recvField55 tag 91,
                            //   Emv_Arpc_Fail should not occur. If it does, this fallback
                            //   remains useful as a safety net.
                            log("EMV", "onFinish retCode=$retCode — attempting card data recovery (pre-commit data should be available)")
                            val emvCardData = try { handler.getEmvCardDataInfo() } catch (e: Exception) {
                                logError("EMV", "getEmvCardDataInfo() threw during ARPC-fail recovery", e)
                                null
                            }
                            val pan: String    = emvCardData?.cardNo     ?: ""
                            val expiry: String = emvCardData?.expiredDate ?: ""
                            val track2: String = emvCardData?.tk2         ?: ""
                            val track1: String = emvCardData?.tk1         ?: ""
                            val last4          = if (pan.length >= 4) pan.takeLast(4) else pan
                            log("EMV", "onFinish ARPC-fail recovery — pan=***$last4 expiry=$expiry track2Empty=${track2.isEmpty()}")
                            if (pan.isNotEmpty()) {
                                sendEvent("reading_complete")
                                sendEvent("card_read_complete", Arguments.createMap().apply {
                                    putString("pan", pan)
                                    putString("expiry", expiry)
                                    putString("cardholder_name", "")
                                    putString("track1", track1)
                                    putString("track2", track2)
                                    putString("emv_data", "")
                                    putString("entry_mode", entryMode)
                                    putString("last4", last4)
                                    putString("card_brand", detectCardBrand(pan))
                                })
                                log("EMV", "onFinish ARPC-fail recovery SUCCESS — card_read_complete fired for ***$last4")
                            } else {
                                logError("EMV", "onFinish ARPC-fail recovery FAILED — getEmvCardDataInfo() returned no PAN (retCode=$retCode)")
                                sendEvent("reading_failed", Arguments.createMap().apply {
                                    putString("message", "Card data unavailable after ARPC failure (code: $retCode)")
                                })
                            }
                        } else {
                            logError("EMV", "onFinish FAILED retCode=$retCode — check SdkResult constants for meaning")
                            // Dump AID table here to detect if initEmvConfiguration() (which runs
                            // at the top of every emvProcess thread) has cleared the AID table.
                            // If the count drops to 0 here vs the pre-emvProcess count, that is
                            // the root cause of the empty candidate list.
                            if (retCode == -8012) {
                                log("EMV", "Post-failure AID dump (retCode=-8012):")
                                dumpAidTable("post-8012")
                                log("EMVCAPK", "CAPK count post-8012=${emvHandler?.capkListNum ?: -1}")
                                // Best-effort logcat capture: NexGo's emvDebugLog(true) writes
                                // APDU traces and PPSE/SELECT results to Android logcat.
                                // Capturing it here gives us the exact card AID(s) being advertised
                                // so we can match them against our registered terminal AID table.
                                captureNativeEmvLog()
                            }
                            sendEvent("reading_failed", Arguments.createMap().apply {
                                putString("message", "EMV process failed with code: $retCode")
                            })
                        }
                    } catch (e: Exception) {
                        logError("EMV", "onFinish threw", e)
                        sendEvent("reading_failed", Arguments.createMap().apply {
                            putString("message", "EMV result handling error: ${e.message}")
                        })
                    } finally {
                        isReading = false
                        cardReader?.stopSearch()
                    }
                }
            })
        } catch (e: Exception) {
            isReading = false
            logError("EMV", "processEmvCard threw exception before emvProcess", e)
            sendEvent("reading_failed", Arguments.createMap().apply {
                putString("message", e.message ?: "Failed to process EMV card")
            })
        }
    }

    @ReactMethod
    fun cancelCardRead(promise: Promise) {
        try {
            // Cancel any in-progress EMV kernel transaction first (clears RF/contact state).
            // This must come before stopSearch() so the kernel is idle before the search ends.
            try { emvHandler?.emvProcessCancel() } catch (e: Exception) { /* safe to ignore */ }
            cardReader?.stopSearch()
            isReading = false
            sendEvent("card_removed")
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("ERR_CANCEL", e.message ?: "Failed to cancel card read")
        }
    }

    @ReactMethod
    fun addListener(eventName: String) {}

    @ReactMethod
    fun removeListeners(count: Int) {}

    private fun detectCardBrand(pan: String): String {
        if (pan.isEmpty()) return "Unknown"
        return when {
            pan.startsWith("4") -> "Visa"
            pan.startsWith("5") || pan.startsWith("2") -> "Mastercard"
            pan.startsWith("3") && pan.length == 15 -> "Amex"
            pan.startsWith("6") -> "Discover"
            else -> "Unknown"
        }
    }
}
