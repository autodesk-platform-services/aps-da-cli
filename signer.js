// This is meant to imitate the behaviour of
// https://github.com/autodesk-platform-services/aps-designautomation-signer/blob/main/Signer.cs
// Author: Jonathan Forsythe

import crypto from "crypto";
import fs from "fs";

export default class Signer {
    constructor(RSA) {
        this.RSA = RSA;
    }
    static load(filePath) {
        const json = fs.readFileSync(filePath, "utf8");
        const rsa = this.fromJson(json);
        return new Signer(rsa);
    }
    static fromJson(json) {
        const rsaParams = JSON.parse(json);
        const key = {
            kty: "RSA",
            d: Buffer.from(rsaParams.D, "base64").toString("base64url"),
            dp: Buffer.from(rsaParams.DP, "base64").toString("base64url"),
            dq: Buffer.from(rsaParams.DQ, "base64").toString("base64url"),
            e: Buffer.from(rsaParams.Exponent, "base64").toString("base64url"),
            qi: Buffer.from(rsaParams.InverseQ, "base64").toString("base64url"),
            n: Buffer.from(rsaParams.Modulus, "base64").toString("base64url"),
            p: Buffer.from(rsaParams.P, "base64").toString("base64url"),
            q: Buffer.from(rsaParams.Q, "base64").toString("base64url"),
        };
        return crypto.createPrivateKey({ key, format: "jwk" });
    }
    static create() {
        const key = crypto.generateKeyPairSync("rsa", {
            modulusLength: 2048,
        });
        return new Signer(key.privateKey);
    }
    save(filePath, isPublic) {
        fs.writeFileSync(filePath, this.toJson(isPublic));
    }
    toJson(isPublic) {
        const key = this.RSA.export({ format: "jwk" });
        const rsaParams = isPublic
            ? {
                  Exponent: Buffer.from(key.e, "base64url").toString("base64"),
                  Modulus: Buffer.from(key.n, "base64url").toString("base64"),
              }
            : {
                  D: Buffer.from(key.d, "base64url").toString("base64"),
                  DP: Buffer.from(key.dp, "base64url").toString("base64"),
                  DQ: Buffer.from(key.dq, "base64url").toString("base64"),
                  Exponent: Buffer.from(key.e, "base64url").toString("base64"),
                  InverseQ: Buffer.from(key.qi, "base64url").toString("base64"),
                  Modulus: Buffer.from(key.n, "base64url").toString("base64"),
                  P: Buffer.from(key.p, "base64url").toString("base64"),
                  Q: Buffer.from(key.q, "base64url").toString("base64"),
              };
        return JSON.stringify(rsaParams, null, 2);
    }
    sign(str) {
        const sign = crypto.createSign("SHA256");
        // Equivalent to Encoding.Unicode.GetBytes(input) in C#
        sign.update(Buffer.from(str, "utf16le"));
        sign.end();
        const signature = sign.sign(this.RSA, "base64");
        return signature;
    }
}