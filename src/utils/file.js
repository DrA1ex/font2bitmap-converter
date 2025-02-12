// File utils
//
// Copyright (C) 2025, Alexander K <https://github.com/drA1ex>
//
// This file may be distributed under the terms of the GNU GPLv3 license

const SaveDelayStep = 100;
let SaveDelay = 0;

/**
 * @param {string} contentType
 * @param {boolean} multiple
 * @return {Promise<*>}
 */
export function openFile(contentType, multiple) {
    return new Promise(resolve => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = multiple;
        input.accept = contentType;

        let timerId = null;

        function _cleanup() {
            if (timerId) clearTimeout(timerId);
            window.removeEventListener("focus", _cancel);

            input.remove();
        }

        function _cancel() {
            timerId = setTimeout(() => {
                if (input.files.length > 0) return;

                _cleanup();
                resolve(multiple ? [] : null);
            }, 300);
        }

        input.onchange = () => {
            const files = Array.from(input.files || []);
            _cleanup();

            if (multiple) {
                resolve(files);
            } else {
                resolve(files[0]);
            }
        };

        setTimeout(() => window.addEventListener("focus", _cancel), 0);

        input.click();
    });
}

/**
 *
 * @param {*} content
 * @param {string} fileName
 * @param {string} contentType
 */
export function saveFile(content, fileName, contentType) {
    return saveFileParts([content], fileName, contentType);
}

/**
 * @param {*[]} parts
 * @param {string} fileName
 * @param {string} contentType
 */
export function saveFileParts(parts, fileName, contentType) {
    const a = document.createElement("a");
    const file = new Blob(parts, { type: contentType });
    a.href = URL.createObjectURL(file);
    a.download = fileName;

    setTimeout(() => {
        a.click();
        console.log(`Download of file ${fileName} started`);
        SaveDelay -= SaveDelayStep;

        setTimeout(() => a.remove());
    }, SaveDelay);

    SaveDelay += SaveDelayStep;
}
