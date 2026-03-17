package com.charrg.pos.nexgo

import android.app.Activity
import android.view.KeyEvent
import android.view.Window
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.nexgo.oaf.apiv3.APIProxy
import com.nexgo.oaf.apiv3.DeviceEngine
import com.nexgo.oaf.apiv3.SdkResult
import com.nexgo.oaf.apiv3.device.reader.CardInfoEntity
import com.nexgo.oaf.apiv3.device.reader.CardReader
import com.nexgo.oaf.apiv3.device.reader.CardSlotTypeEnum
import com.nexgo.oaf.apiv3.device.reader.OnCardInfoListener
import com.nexgo.oaf.apiv3.emv.CandidateAppInfoEntity
import com.nexgo.oaf.apiv3.emv.EmvHandler2
import com.nexgo.oaf.apiv3.emv.EmvProcessResultEntity
import com.nexgo.oaf.apiv3.emv.EmvOnlineResultEntity
import com.nexgo.oaf.apiv3.emv.EmvTransConfigurationEntity
import com.nexgo.oaf.apiv3.emv.OnEmvProcessListener2

class NexGoSDKModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private var deviceEngine: DeviceEngine? = null
    private var cardReader: CardReader? = null
    private var emvHandler: EmvHandler2? = null
    private var isReading = false

    // Physical keypad interception
    private var originalWindowCallback: Window.Callback? = null
    private var keypadListenerActive = false

    override fun getName(): String = "NexGoSDK"

    private fun sendEvent(eventName: String, params: WritableMap? = null) {
        reactApplicationContext
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
        val activity = currentActivity
        if (activity == null) {
            promise.reject("ERR_NO_ACTIVITY", "No current activity available")
            return
        }
        if (keypadListenerActive) {
            promise.resolve(null)
            return
        }

        val window = activity.window
        originalWindowCallback = window.callback

        // Kotlin `by` delegation forwards every method we don't override to
        // the original callback, so we only need to handle dispatchKeyEvent.
        val original = originalWindowCallback!!
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
                }
                return original.dispatchKeyEvent(event)
            }
        }

        keypadListenerActive = true
        promise.resolve(null)
    }

    @ReactMethod
    fun stopKeypadListener(promise: Promise) {
        val activity = currentActivity
        if (activity != null && originalWindowCallback != null) {
            activity.window.callback = originalWindowCallback
            originalWindowCallback = null
        }
        keypadListenerActive = false
        promise.resolve(null)
    }

    // ─── SDK init ─────────────────────────────────────────────────────────────

    @ReactMethod
    fun initialize(promise: Promise) {
        try {
            deviceEngine = APIProxy.getDeviceEngine(reactApplicationContext)
            if (deviceEngine == null) {
                promise.resolve(false)
                return
            }
            cardReader = deviceEngine!!.cardReader
            emvHandler = deviceEngine!!.getEmvHandler2("app1")
            promise.resolve(true)
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun getDeviceInfo(promise: Promise) {
        try {
            val engine = deviceEngine ?: APIProxy.getDeviceEngine(reactApplicationContext)
            if (engine == null) {
                promise.reject("ERR_NOT_INITIALIZED", "DeviceEngine unavailable")
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
        if (deviceEngine == null || cardReader == null) {
            promise.reject("ERR_NOT_INITIALIZED", "SDK not initialized")
            return
        }

        if (isReading) {
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

            cardReader!!.searchCard(slotTypes, 60, object : OnCardInfoListener {
                override fun onCardInfo(retCode: Int, cardInfo: CardInfoEntity?) {
                    if (retCode != SdkResult.Success || cardInfo == null) {
                        isReading = false
                        if (retCode == SdkResult.TimeOut) {
                            sendEvent("timeout")
                        } else {
                            sendEvent("reading_failed", Arguments.createMap().apply {
                                putString("message", "Card read failed with code: $retCode")
                            })
                        }
                        return
                    }

                    when (cardInfo.cardExistslot) {
                        CardSlotTypeEnum.ICC1 -> {
                            sendEvent("card_inserted")
                            processEmvCard(amount, cardInfo, "chip")
                        }
                        CardSlotTypeEnum.RF -> {
                            sendEvent("card_tapped")
                            processEmvCard(amount, cardInfo, "contactless")
                        }
                        CardSlotTypeEnum.SWIPE -> {
                            sendEvent("card_swiped")
                            processSwipeCard(cardInfo)
                        }
                        else -> {
                            isReading = false
                            sendEvent("reading_failed", Arguments.createMap().apply {
                                putString("message", "Unknown card slot type")
                            })
                        }
                    }
                }

                override fun onSwipeIncorrect() {
                    sendEvent("reading_failed", Arguments.createMap().apply {
                        putString("message", "Swipe incorrect, please try again")
                    })
                }

                override fun onMultipleCards() {
                    sendEvent("reading_failed", Arguments.createMap().apply {
                        putString("message", "Multiple cards detected, please present one card")
                    })
                }
            })

            promise.resolve(null)
        } catch (e: Exception) {
            isReading = false
            promise.reject("ERR_CARD_READ", e.message ?: "Card read failed")
        }
    }

    private fun processSwipeCard(cardInfo: CardInfoEntity) {
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
            sendEvent("reading_failed", Arguments.createMap().apply {
                putString("message", e.message ?: "Failed to process swipe card")
            })
        } finally {
            isReading = false
        }
    }

    private fun processEmvCard(amount: Double, cardInfo: CardInfoEntity, entryMode: String) {
        try {
            val emvTransConfig = EmvTransConfigurationEntity().apply {
                transAmount = (amount * 100).toLong().toString()
                countryCode = "0840"
                currencyCode = "0840"
                emvTransType = 0x00
            }

            emvHandler?.emvProcess(emvTransConfig, object : OnEmvProcessListener2 {

                override fun onSelApp(
                    appNameList: MutableList<String>?,
                    appInfoList: MutableList<CandidateAppInfoEntity>?,
                    isFirstSelect: Boolean
                ) {
                    emvHandler?.onSetSelAppResponse(0)
                }

                override fun onTransInitBeforeGPO() {}

                override fun onConfirmCardNo(cardInfoEntity: CardInfoEntity) {
                    emvHandler?.onSetConfirmCardNoResponse(true)
                }

                override fun onCardHolderInputPin(isOnlinePin: Boolean, leftTimes: Int) {
                    sendEvent("pin_requested")
                    emvHandler?.onSetPinInputResponse(isOnlinePin, false)
                    sendEvent("pin_entered")
                }

                override fun onContactlessTapCardAgain() {
                    sendEvent("reading_failed", Arguments.createMap().apply {
                        putString("message", "Please tap your card again")
                    })
                }

                override fun onOnlineProc() {
                    emvHandler?.onSetOnlineProcResponse(SdkResult.Success, null)
                }

                override fun onPrompt(promptEnum: com.nexgo.oaf.apiv3.emv.PromptEnum?) {}

                override fun onRemoveCard() {
                    sendEvent("card_removed")
                }

                override fun onFinish(retCode: Int, result: EmvProcessResultEntity?) {
                    if (retCode == SdkResult.Success) {
                        val pan: String = cardInfo.cardNo ?: ""
                        val expiry: String = cardInfo.expiredDate ?: ""
                        val track2: String = cardInfo.tk2 ?: ""

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
