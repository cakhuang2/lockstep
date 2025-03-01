
let ws: WebSocket = null;
let route: string[] = [];
let heartbeatTimer: any = null;
let heartbeatResTimeoutTimer: any = null;

let handlers: { [cmdIndex: number]: Function } = {};
let bindedObj: { [cmdIndex: number]: any } = {};
let msgCache: { "id": number, "data": any }[] = [];
let openOrClose = { "open": -1, "close": -2 };
let tmpBuf = { "len": 0, "buffer": new Uint8Array(0) };
let md5 = "";

export class network {
    /**
     * 连接服务器
     * @param host 
     * @param port 
     */
    static connect(host: string, port: number) {
        network.disconnect();
        tmpBuf.len = 0;
        tmpBuf.buffer = new Uint8Array(0);
        let url = "ws://" + host + ":" + port;
        ws = new WebSocket(url);
        ws.binaryType = 'arraybuffer';
        ws.onopen = function () {
            // 握手
            let md5Msg = strencode(JSON.stringify({ "md5": md5 }));
            let msgLen = 1 + md5Msg.length;
            let buffer = new Uint8Array(5 + md5Msg.length);
            buffer[0] = msgLen >> 24 & 0xff;
            buffer[1] = msgLen >> 16 & 0xff;
            buffer[2] = msgLen >> 8 & 0xff;
            buffer[3] = msgLen & 0xff;
            buffer[4] = 2 & 0xff;
            for (let i = 0; i < md5Msg.length; i++) {
                buffer[i + 5] = md5Msg[i];
            }
            ws.send(buffer.buffer);

        };

        ws.onerror = function () {
        };

        ws.onclose = function () {
            clearInterval(heartbeatTimer);
            clearTimeout(heartbeatResTimeoutTimer);
            heartbeatResTimeoutTimer = null;
            msgCache.push({ "id": openOrClose.close, "data": null });
            ws = null;
        };
        ws.onmessage = function (event) {
            handleMsg(new Uint8Array(event.data));
        };
    }

    /**
     * 断开连接
     */
    static disconnect() {
        if (ws) {
            ws.onopen = function () { };
            ws.onerror = function () { };
            ws.onclose = function () { };
            ws.onmessage = function () { };
            ws.close();
            ws = null;
            tmpBuf.len = 0;
            tmpBuf.buffer = new Uint8Array(0);
            clearInterval(heartbeatTimer);
            clearTimeout(heartbeatResTimeoutTimer);
            heartbeatResTimeoutTimer = null;
        }
    }


    /**
     * 添加网络连接成功的消息监听
     * @param cb 
     * @param self 
     */
    static onOpen(cb: (msg?: any) => void, self: any) {
        handlers[openOrClose.open] = cb.bind(self);
        bindedObj[openOrClose.open] = self;
    }

    /**
     * 移除网络连接成功的消息监听
     */
    static offOpen() {
        delete handlers[openOrClose.open];
        delete bindedObj[openOrClose.open];
    }

    /**
     * 添加网络断开的消息监听
     * @param cb 
     * @param self 
     */
    static onClose(cb: () => void, self: any) {
        handlers[openOrClose.close] = cb.bind(self);
        bindedObj[openOrClose.close] = self;
    }

    /**
     * 移除网络断开的消息监听
     */
    static offClose() {
        delete handlers[openOrClose.close];
        delete bindedObj[openOrClose.close];
    }

    /**
     * 添加消息监听
     * @param cmd 
     * @param cb 
     * @param self 
     */
    static addHandler(cmd: string, cb: (msg?: any) => void, self: any) {
        let cmdIndex = route.indexOf(cmd);
        if (cmdIndex === -1) {
            console.warn("cmd not exists:", cmd);
            return;
        }
        handlers[cmdIndex] = cb.bind(self);
        bindedObj[cmdIndex] = self;
    }

    /**
     * 移除绑定的消息监听
     * @param self 
     */
    static removeThisHandlers(self: any) {
        for (let index in bindedObj) {
            if (bindedObj[index] === self) {
                delete bindedObj[index];
                delete handlers[index];
            }
        }
    }

    /**
     * 发送消息
     * @param cmd 
     * @param data 
     */
    static sendMsg(cmd: string, data?: any) {
        if (!ws || ws.readyState !== 1) {
            console.warn("ws is null");
            return;
        }

        let cmdIndex = route.indexOf(cmd);
        if (cmdIndex === -1) {
            console.warn("cmd not exists:", cmd);
            return;
        }
        if (data === undefined) {
            data = null;
        }
        let buffer = encode(cmdIndex, data);
        ws.send(buffer.buffer);
    }

    /**
     * 读取消息
     */
    static readMsg() {
        if (msgCache.length > 0) {
            let tmp = msgCache.shift();
            if (handlers[tmp.id]) {
                handlers[tmp.id](tmp.data);
            }
        }
    }

    static isConnected() {
        return !!ws
    }

}


function encode(cmdIndex: number, data: any) {
    let dataBuf = strencode(JSON.stringify(data));
    let msg_len = dataBuf.length + 3;
    let buffer = new Uint8Array(msg_len + 4);
    let index = 0;
    buffer[index++] = msg_len >> 24 & 0xff;
    buffer[index++] = msg_len >> 16 & 0xff;
    buffer[index++] = msg_len >> 8 & 0xff;
    buffer[index++] = msg_len & 0xff;
    buffer[index++] = 1 & 0xff;
    buffer[index++] = cmdIndex >> 8 & 0xff;
    buffer[index++] = cmdIndex & 0xff;
    copyArray(buffer, index, dataBuf, 0, dataBuf.length);
    return buffer;
}


function handleMsg(data: Uint8Array) {
    try {
        let index = 0;
        while (index < data.length) {
            let msgLen = (data[index] << 24) | (data[index + 1] << 16) | (data[index + 2] << 8) | data[index + 3];
            if (data[index + 4] === 1) {
                msgCache.push({ "id": (data[index + 5] << 8) | data[index + 6], "data": JSON.parse(strdecode(data.subarray(index + 7, index + 4 + msgLen))) });
            } else if (data[index + 4] === 2) { //握手
                handshakeOver(JSON.parse(strdecode(data.subarray(index + 5, index + 4 + msgLen))));
            } else if (data[index + 4] === 3) {  // 心跳回调
                clearTimeout(heartbeatResTimeoutTimer);
                heartbeatResTimeoutTimer = null;
            }
            index += msgLen + 4;
        }
    } catch (e) {
        console.log(e);
    }
}

function handshakeOver(msg: { "route": string[], "md5": string, "heartbeat": number }) {
    md5 = msg.md5;
    if (msg.route) {
        route = msg.route;
    }
    if (msg.heartbeat > 0) {
        heartbeatTimer = setInterval(sendHeartbeat, msg.heartbeat * 1000);
    }
    msgCache.push({ "id": openOrClose.open, "data": null })
}

function sendHeartbeat() {
    // 心跳
    let buffer = new Uint8Array(5);
    buffer[0] = 1 >> 24 & 0xff;
    buffer[1] = 1 >> 16 & 0xff;
    buffer[2] = 1 >> 8 & 0xff;
    buffer[3] = 1 & 0xff;
    buffer[4] = 3 & 0xff;
    ws.send(buffer.buffer);

    if (heartbeatResTimeoutTimer === null) {
        heartbeatResTimeoutTimer = setTimeout(function () {
            msgCache.push({ "id": openOrClose.close, "data": null })
            network.disconnect();
        }, 5 * 1000);
    }
}


function strencode(str: string) {
    let byteArray: number[] = [];
    for (let i = 0; i < str.length; i++) {
        let charCode = str.charCodeAt(i);
        if (charCode <= 0x7f) {
            byteArray.push(charCode);
        } else if (charCode <= 0x7ff) {
            byteArray.push(0xc0 | (charCode >> 6), 0x80 | (charCode & 0x3f));
        } else if (charCode <= 0xffff) {
            byteArray.push(0xe0 | (charCode >> 12), 0x80 | ((charCode & 0xfc0) >> 6), 0x80 | (charCode & 0x3f));
        } else {
            byteArray.push(0xf0 | (charCode >> 18), 0x80 | ((charCode & 0x3f000) >> 12), 0x80 | ((charCode & 0xfc0) >> 6), 0x80 | (charCode & 0x3f));
        }
    }
    return new Uint8Array(byteArray);
}



function strdecode(bytes: Uint8Array) {
    let array: number[] = [];
    let offset = 0;
    let charCode = 0;
    let end = bytes.length;
    while (offset < end) {
        if (bytes[offset] < 128) {
            charCode = bytes[offset];
            offset += 1;
        } else if (bytes[offset] < 224) {
            charCode = ((bytes[offset] & 0x3f) << 6) + (bytes[offset + 1] & 0x3f);
            offset += 2;
        } else if (bytes[offset] < 240) {
            charCode = ((bytes[offset] & 0x0f) << 12) + ((bytes[offset + 1] & 0x3f) << 6) + (bytes[offset + 2] & 0x3f);
            offset += 3;
        } else {
            charCode = ((bytes[offset] & 0x07) << 18) + ((bytes[offset + 1] & 0x3f) << 12) + ((bytes[offset + 1] & 0x3f) << 6) + (bytes[offset + 2] & 0x3f);
            offset += 4;
        }
        array.push(charCode);
    }
    return String.fromCharCode.apply(null, array);
}

function copyArray(dest: Uint8Array, doffset: number, src: Uint8Array, soffset: number, length: number) {
    for (let index = 0; index < length; index++) {
        dest[doffset++] = src[soffset++];
    }
}
