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
import com.nexgo.oaf.apiv3.APIProxy
import com.nexgo.oaf.apiv3.DeviceEngine
import com.nexgo.oaf.apiv3.SdkResult
import com.nexgo.oaf.apiv3.device.reader.CardInfoEntity
import com.nexgo.oaf.apiv3.device.reader.CardReader
import com.nexgo.oaf.apiv3.device.reader.CardSlotTypeEnum
import com.nexgo.oaf.apiv3.device.reader.OnCardInfoListener
import com.nexgo.oaf.apiv3.emv.AidEntity
import com.nexgo.oaf.apiv3.emv.AidEntryModeEnum
import com.nexgo.oaf.apiv3.emv.CandidateAppInfoEntity
import com.nexgo.oaf.apiv3.emv.EmvHandler2
import com.nexgo.oaf.apiv3.emv.EmvProcessResultEntity
import com.nexgo.oaf.apiv3.emv.EmvOnlineResultEntity
import com.nexgo.oaf.apiv3.emv.EmvTransConfigurationEntity
import com.nexgo.oaf.apiv3.emv.OnEmvProcessListener2

class NexGoSDKModule(private val reactCtx: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactCtx) {

    private var deviceEngine: DeviceEngine? = null
    private var cardReader: CardReader? = null
    private var emvHandler: EmvHandler2? = null
    private var isReading = false

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
            setupEmvAids()
            log("INIT", "initialize() complete — AIDs configured: ${emvHandler?.aidListNum ?: 0}")
            promise.resolve(true)
        } catch (e: Exception) {
            logError("INIT", "initialize() threw exception", e)
            promise.reject("ERR_INITIALIZE", e.message ?: "APIProxy.getDeviceEngine failed")
        }
    }

    /**
     * Configure AIDs (Application Identifiers) for the EMV kernel.
     *
     * Without AIDs the kernel's candidate list is empty and every EMV process
     * call fails immediately (error 8014 / Emv_Candidatelist_Empty).
     *
     * Values follow standard US terminal parameters:
     *   • Floor limit 0 = always go online (no offline approval)
     *   • Contactless trans limit $250 / CVM limit $25
     *   • AidEntryModeEnum.AID_ENTRY_CONTACT_CONTACTLESS = accept both interfaces
     */
    private fun setupEmvAids() {
        val handler = emvHandler ?: run {
            logError("EMVAID", "emvHandler is null — cannot configure AIDs")
            return
        }
        val existing = handler.aidListNum
        if (existing > 0) {
            log("EMVAID", "Skipping — device already has $existing AID(s) configured")
            return
        }
        log("EMVAID", "Configuring standard US payment AIDs")

        val aids = mutableListOf<AidEntity>()

        // ── Visa Credit / Debit ──────────────────────────────────────────────
        aids.add(AidEntity().apply {
            setAid("A0000000031010")
            setAsi(0)                        // partial match
            setAppVerNum("0096")
            setTacDefault("DC4000A800")
            setTacOnline("DC4004F800")
            setTacDenial("0010000000")
            setFloorLimit(0L)
            setContactlessTransLimit(25000L) // $250.00
            setContactlessCvmLimit(2500L)    // $25.00 — above this, PIN required
            setContactlessFloorLimit(0L)
            setAidEntryModeEnum(AidEntryModeEnum.AID_ENTRY_CONTACT_CONTACTLESS)
        })

        // ── Visa Electron ────────────────────────────────────────────────────
        aids.add(AidEntity().apply {
            setAid("A0000000032010")
            setAsi(0)
            setAppVerNum("0096")
            setTacDefault("DC4000A800")
            setTacOnline("DC4004F800")
            setTacDenial("0010000000")
            setFloorLimit(0L)
            setContactlessTransLimit(25000L)
            setContactlessCvmLimit(2500L)
            setContactlessFloorLimit(0L)
            setAidEntryModeEnum(AidEntryModeEnum.AID_ENTRY_CONTACT_CONTACTLESS)
        })

        // ── Mastercard Credit ────────────────────────────────────────────────
        aids.add(AidEntity().apply {
            setAid("A0000000041010")
            setAsi(0)
            setAppVerNum("0002")
            setTacDefault("FC50BCF800")
            setTacOnline("FC50BCF800")
            setTacDenial("0000000000")
            setFloorLimit(0L)
            setContactlessTransLimit(25000L)
            setContactlessCvmLimit(2500L)
            setContactlessFloorLimit(0L)
            setAidEntryModeEnum(AidEntryModeEnum.AID_ENTRY_CONTACT_CONTACTLESS)
        })

        // ── Maestro (Mastercard Debit) ───────────────────────────────────────
        aids.add(AidEntity().apply {
            setAid("A0000000043060")
            setAsi(0)
            setAppVerNum("0002")
            setTacDefault("FC50BCF800")
            setTacOnline("FC50BCF800")
            setTacDenial("0000000000")
            setFloorLimit(0L)
            setContactlessTransLimit(25000L)
            setContactlessCvmLimit(2500L)
            setContactlessFloorLimit(0L)
            setAidEntryModeEnum(AidEntryModeEnum.AID_ENTRY_CONTACT_CONTACTLESS)
        })

        // ── American Express ─────────────────────────────────────────────────
        aids.add(AidEntity().apply {
            setAid("A000000025010104")
            setAsi(1)                        // exact match for Amex
            setAppVerNum("0001")
            setTacDefault("FC78BCF800")
            setTacOnline("F878BC7800")
            setTacDenial("0000000000")
            setFloorLimit(0L)
            setContactlessTransLimit(25000L)
            setContactlessCvmLimit(2500L)
            setContactlessFloorLimit(0L)
            setAidEntryModeEnum(AidEntryModeEnum.AID_ENTRY_CONTACT_CONTACTLESS)
        })

        // ── Discover / Diners Club ───────────────────────────────────────────
        aids.add(AidEntity().apply {
            setAid("A0000001523010")
            setAsi(1)
            setAppVerNum("0001")
            setTacDefault("F800F0A000")
            setTacOnline("F800F0A000")
            setTacDenial("0000000000")
            setFloorLimit(0L)
            setContactlessTransLimit(25000L)
            setContactlessCvmLimit(2500L)
            setContactlessFloorLimit(0L)
            setAidEntryModeEnum(AidEntryModeEnum.AID_ENTRY_CONTACT_CONTACTLESS)
        })

        val result = handler.setAidParaList(aids)
        log("EMVAID", "setAidParaList result=$result, total AIDs now=${handler.aidListNum}")
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
                        CardSlotTypeEnum.ICC1 -> {
                            log("CARD", "Card inserted (chip/ICC)")
                            sendEvent("card_inserted")
                            processEmvCard(amount, cardInfo, "chip")
                        }
                        CardSlotTypeEnum.RF -> {
                            log("CARD", "Card tapped (contactless/RF)")
                            sendEvent("card_tapped")
                            processEmvCard(amount, cardInfo, "contactless")
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

    private fun processEmvCard(amount: Double, cardInfo: CardInfoEntity, entryMode: String) {
        log("EMV", "processEmvCard() entryMode=$entryMode amount=$amount")
        try {
            val now = java.util.Calendar.getInstance()
            val emvTransConfig = EmvTransConfigurationEntity().apply {
                transAmount  = (amount * 100).toLong().toString()
                countryCode  = "0840"        // ISO 3166-1: USA
                currencyCode = "0840"        // ISO 4217:   USD
                emvTransType = 0x00          // 00 = Goods & Services
                // Date/time required by EMV kernel
                transDate = String.format("%02d%02d%02d",
                    now.get(java.util.Calendar.YEAR) % 100,
                    now.get(java.util.Calendar.MONTH) + 1,
                    now.get(java.util.Calendar.DAY_OF_MONTH))
                transTime = String.format("%02d%02d%02d",
                    now.get(java.util.Calendar.HOUR_OF_DAY),
                    now.get(java.util.Calendar.MINUTE),
                    now.get(java.util.Calendar.SECOND))
                termId   = "CHARRG01"
                merId    = "CHARRG"
                // NexGo SDK stores merchant name as a raw byte array (ASCII bytes)
                merName  = "Charrg POS".toByteArray(Charsets.US_ASCII)
                // Allow the kernel to show a card application selection UI if
                // multiple apps are present on a contactless card
                isContactlessSupportSelectApp = (entryMode == "contactless")
            }
            log("EMV", "emvProcess() starting — transDate=${emvTransConfig.transDate} transTime=${emvTransConfig.transTime}")

            emvHandler?.emvProcess(emvTransConfig, object : OnEmvProcessListener2 {

                override fun onSelApp(
                    appNameList: MutableList<String>?,
                    appInfoList: MutableList<CandidateAppInfoEntity>?,
                    isFirstSelect: Boolean
                ) {
                    log("EMV", "onSelApp — apps=${appNameList?.joinToString() ?: "none"} isFirstSelect=$isFirstSelect — auto-selecting index 0")
                    emvHandler?.onSetSelAppResponse(0)
                }

                override fun onTransInitBeforeGPO() {
                    log("EMV", "onTransInitBeforeGPO")
                }

                override fun onConfirmCardNo(cardInfoEntity: CardInfoEntity) {
                    log("EMV", "onConfirmCardNo — last4=${cardInfoEntity.cardNo?.takeLast(4) ?: "?"}")
                    emvHandler?.onSetConfirmCardNoResponse(true)
                }

                override fun onCardHolderInputPin(isOnlinePin: Boolean, leftTimes: Int) {
                    log("EMV", "onCardHolderInputPin — isOnlinePin=$isOnlinePin leftTimes=$leftTimes — bypassing PIN")
                    sendEvent("pin_requested")
                    emvHandler?.onSetPinInputResponse(isOnlinePin, false)
                    sendEvent("pin_entered")
                }

                override fun onContactlessTapCardAgain() {
                    log("EMV", "onContactlessTapCardAgain — asking user to re-tap")
                    sendEvent("reading_failed", Arguments.createMap().apply {
                        putString("message", "Please tap your card again")
                    })
                }

                override fun onOnlineProc() {
                    log("EMV", "onOnlineProc — responding with Success")
                    emvHandler?.onSetOnlineProcResponse(SdkResult.Success, null)
                }

                override fun onPrompt(promptEnum: com.nexgo.oaf.apiv3.emv.PromptEnum?) {
                    log("EMV", "onPrompt — $promptEnum")
                }

                override fun onRemoveCard() {
                    log("EMV", "onRemoveCard")
                    sendEvent("card_removed")
                }

                override fun onFinish(retCode: Int, result: EmvProcessResultEntity?) {
                    log("EMV", "onFinish retCode=$retCode (Success=${SdkResult.Success}) result=${result?.javaClass?.simpleName ?: "null"}")
                    if (retCode == SdkResult.Success) {
                        val pan: String = cardInfo.cardNo ?: ""
                        val expiry: String = cardInfo.expiredDate ?: ""
                        val track2: String = cardInfo.tk2 ?: ""

                        log("EMV", "onFinish SUCCESS — pan=***${pan.takeLast(4)} expiry=$expiry brand=${detectCardBrand(pan)} entryMode=$entryMode")
                        sendEvent("reading_complete")
                        sendEvent("card_read_complete", Arguments.createMap().apply {
                            putString("pan", pan)
                            putString("expiry", expiry)
                            putString("cardholder_name", "")
                            putString("track1", cardInfo.tk1 ?: "")
                            putString("track2", track2)
                            putString("emv_data", "")
                            putString("entry_mode", entryMode)
                            putString("last4", if (pan.length >= 4) pan.takeLast(4) else "")
                            putString("card_brand", detectCardBrand(pan))
                        })
                    } else {
                        logError("EMV", "onFinish FAILED retCode=$retCode")
                        sendEvent("reading_failed", Arguments.createMap().apply {
                            putString("message", "EMV process failed with code: $retCode")
                        })
                    }

                    isReading = false
                    cardReader?.stopSearch()
                }
            })
        } catch (e: Exception) {
            isReading = false
            logError("EMV", "processEmvCard threw exception", e)
            sendEvent("reading_failed", Arguments.createMap().apply {
                putString("message", e.message ?: "Failed to process EMV card")
            })
        }
    }

    @ReactMethod
    fun cancelCardRead(promise: Promise) {
        try {
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
