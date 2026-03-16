package com.charrg.pos.nexgo

import android.os.Bundle
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.nexgo.oaf.apiv3.DeviceEngine
import com.nexgo.oaf.apiv3.SdkResult
import com.nexgo.oaf.apiv3.card.cpu.EmvHandler2
import com.nexgo.oaf.apiv3.card.cpu.EmvProcessFlowEnum
import com.nexgo.oaf.apiv3.card.cpu.EmvTransConfigurationV2
import com.nexgo.oaf.apiv3.card.cpu.OnEmvProcessListener2
import com.nexgo.oaf.apiv3.card.mifare.OnSwipeCardListener
import com.nexgo.oaf.apiv3.card.rf.OnRfCardListener
import com.nexgo.oaf.apiv3.device.reader.CardInfoEntity
import com.nexgo.oaf.apiv3.device.reader.CardReader
import com.nexgo.oaf.apiv3.device.reader.CardSlotTypeEnum
import com.nexgo.oaf.apiv3.device.reader.OnCardInfoListener

class NexGoSDKModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private var deviceEngine: DeviceEngine? = null
    private var cardReader: CardReader? = null
    private var emvHandler: EmvHandler2? = null
    private var isReading = false

    override fun getName(): String = "NexGoSDK"

    private fun sendEvent(eventName: String, params: WritableMap? = null) {
        reactApplicationContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, params ?: Arguments.createMap())
    }

    @ReactMethod
    fun initialize(promise: Promise) {
        try {
            deviceEngine = DeviceEngine.getDeviceEngine()
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
                            val params = Arguments.createMap().apply {
                                putString("message", "Card read failed with code: $retCode")
                            }
                            sendEvent("reading_failed", params)
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
                            val params = Arguments.createMap().apply {
                                putString("message", "Unknown card slot type")
                            }
                            sendEvent("reading_failed", params)
                        }
                    }
                }

                override fun onSwipeIncorrect() {
                    val params = Arguments.createMap().apply {
                        putString("message", "Swipe incorrect, please try again")
                    }
                    sendEvent("reading_failed", params)
                }

                override fun onMultipleCards() {
                    val params = Arguments.createMap().apply {
                        putString("message", "Multiple cards detected, please present one card")
                    }
                    sendEvent("reading_failed", params)
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
            val track3 = cardInfo.tk3 ?: ""

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
                if (t1Parts.size >= 2) {
                    cardholderName = t1Parts[1].trim()
                }
            }

            sendEvent("reading_complete")

            val params = Arguments.createMap().apply {
                putString("pan", pan)
                putString("expiry", expiry)
                putString("cardholder_name", cardholderName)
                putString("track1", track1)
                putString("track2", track2)
                putString("entry_mode", "swipe")
                putString("last4", if (pan.length >= 4) pan.takeLast(4) else "")
                putString("card_brand", detectCardBrand(pan))
            }

            sendEvent("card_read_complete", params)
        } catch (e: Exception) {
            val params = Arguments.createMap().apply {
                putString("message", e.message ?: "Failed to process swipe card")
            }
            sendEvent("reading_failed", params)
        } finally {
            isReading = false
        }
    }

    private fun processEmvCard(amount: Double, cardInfo: CardInfoEntity, entryMode: String) {
        try {
            val emvTransConfig = EmvTransConfigurationV2().apply {
                transAmount = (amount * 100).toLong().toString()
                countryCode = "0840"
                transCurrCode = "0840"
                transType = 0x00
            }

            emvHandler?.emvProcess(emvTransConfig, object : OnEmvProcessListener2 {
                override fun onSelApp(
                    appNameList: MutableList<String>?,
                    appInfoList: MutableList<com.nexgo.oaf.apiv3.card.cpu.CandidateAppInfoEntity>?,
                    isFirstSelect: Boolean
                ) {
                    emvHandler?.onSetSelAppResponse(0)
                }

                override fun onConfirmCardNo(cardNo: String?) {
                    emvHandler?.onSetConfirmCardNoResponse(true)
                }

                override fun onCardHolderInputPin(isOnlinePin: Boolean, leftTimes: Int) {
                    sendEvent("pin_requested")
                    emvHandler?.onSetCardHolderInputPinResponse(isOnlinePin, "")
                    sendEvent("pin_entered")
                }

                override fun onOnlineProc() {
                    emvHandler?.onSetOnlineProcResponse(
                        SdkResult.Success,
                        null,
                        null
                    )
                }

                override fun onFinish(retCode: Int, emvProcessResultEntity: com.nexgo.oaf.apiv3.card.cpu.EmvProcessResultEntity?) {
                    if (retCode == SdkResult.Success && emvProcessResultEntity != null) {
                        val pan = emvProcessResultEntity.cardNo ?: ""
                        val expiry = emvProcessResultEntity.expDate ?: ""
                        val cardholderName = emvProcessResultEntity.cardHolderName ?: ""
                        val track2 = emvProcessResultEntity.track2 ?: ""
                        val emvData = emvProcessResultEntity.emvTlvData ?: ""

                        sendEvent("reading_complete")

                        val params = Arguments.createMap().apply {
                            putString("pan", pan)
                            putString("expiry", expiry)
                            putString("cardholder_name", cardholderName)
                            putString("track1", "")
                            putString("track2", track2)
                            putString("emv_data", emvData)
                            putString("entry_mode", entryMode)
                            putString("last4", if (pan.length >= 4) pan.takeLast(4) else "")
                            putString("card_brand", detectCardBrand(pan))
                        }

                        sendEvent("card_read_complete", params)
                    } else {
                        val params = Arguments.createMap().apply {
                            putString("message", "EMV process failed with code: $retCode")
                        }
                        sendEvent("reading_failed", params)
                    }

                    isReading = false
                    cardReader?.stopSearch()
                }
            })
        } catch (e: Exception) {
            isReading = false
            val params = Arguments.createMap().apply {
                putString("message", e.message ?: "Failed to process EMV card")
            }
            sendEvent("reading_failed", params)
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
            pan.startsWith("3") && (pan.length == 15) -> "Amex"
            pan.startsWith("6") -> "Discover"
            else -> "Unknown"
        }
    }
}
