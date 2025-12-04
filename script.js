const STORAGE_KEY = 'weatherAppStateV2';


let appState = {
    useGeolocation: true,
    mainCity: null,
    extraCities: []
};


function loadState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (typeof parsed === 'object' && parsed) {
            appState = {
                useGeolocation: Boolean(parsed.useGeolocation),
                mainCity: parsed.mainCity || null,
                extraCities: Array.isArray(parsed.extraCities) ? parsed.extraCities : []
            };
        }
    } catch (e) {
        console.warn('Ошибка чтения localStorage:', e);
    }
}

function saveState() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
    } catch (e) {
        console.warn('Ошибка записи localStorage:', e);
    }
}

function describeWeatherCode(code) {
    if (code === 0) return 'Ясно';
    if ([1, 2].includes(code)) return 'Переменная облачность';
    if (code === 3) return 'Пасмурно';
    if ([45, 48].includes(code)) return 'Туман';
    if ([51, 53, 55].includes(code)) return 'Морось';
    if ([61, 63, 65].includes(code)) return 'Дождь';
    if ([66, 67].includes(code)) return 'Ледяной дождь';
    if ([71, 73, 75].includes(code)) return 'Снег';
    if ([80, 81, 82].includes(code)) return 'Ливень';
    if ([95].includes(code)) return 'Гроза';
    if ([96, 99].includes(code)) return 'Гроза с градом';
    return 'Неизвестная погода';
}

function createForecastDay(dateStr, tMin, tMax, code, isToday = false) {
    const el = document.createElement('div');
    el.className = 'forecast-day';

    const dateEl = document.createElement('div');
    dateEl.className = 'forecast-day__date';

    if (isToday) {
        dateEl.textContent = 'Сегодня';
    } else {
        const date = new Date(dateStr);
        const formatter = new Intl.DateTimeFormat('ru-RU', {
            weekday: 'short',
            day: 'numeric',
            month: 'short'
        });
        dateEl.textContent = formatter.format(date);
    }

    const tempEl = document.createElement('div');
    tempEl.className = 'forecast-day__temp';
    tempEl.textContent = `${Math.round(tMin)}…${Math.round(tMax)}°C`;

    const descEl = document.createElement('div');
    descEl.className = 'forecast-day__desc';
    descEl.textContent = describeWeatherCode(code);

    el.appendChild(dateEl);
    el.appendChild(tempEl);
    el.appendChild(descEl);

    return el;
}


function buildWeatherUrl(lat, lon) {
    const params = new URLSearchParams({
        latitude: String(lat),
        longitude: String(lon),
        daily: 'temperature_2m_max,temperature_2m_min,weathercode',
        forecast_days: '3',
        timezone: 'auto'
    });
    return `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
}

async function fetchWeather(lat, lon) {
    const url = buildWeatherUrl(lat, lon);
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`Ошибка HTTP: ${res.status}`);
    }
    const data = await res.json();
    if (!data.daily || !data.daily.time) {
        throw new Error('Некорректный ответ сервера');
    }
    return data.daily;
}

async function renderForecastForCoords(target) {
    const { lat, lon, statusEl, forecastContainer } = target;

    statusEl.textContent = 'Загрузка прогноза...';
    statusEl.className = 'status status--loading';
    forecastContainer.innerHTML = '';

    try {
        const daily = await fetchWeather(lat, lon);

        forecastContainer.innerHTML = '';
        const count = Math.min(3, daily.time.length);

        for (let i = 0; i < count; i++) {
            const isToday = (i === 0);

            const dayEl = createForecastDay(
                daily.time[i],
                daily.temperature_2m_min[i],
                daily.temperature_2m_max[i],
                daily.weathercode[i],
                isToday
            );
            forecastContainer.appendChild(dayEl);
        }

        statusEl.textContent = 'Прогноз успешно загружен';
        statusEl.className = 'status';
    } catch (err) {
        console.error(err);
        statusEl.textContent = 'Ошибка загрузки прогноза: ' + err.message;
        statusEl.className = 'status status--error';
    }
}

function buildCityFromApiItem(item) {
    return {
        id: item.id,
        name: item.name,
        country: item.country || '',
        lat: item.latitude,
        lon: item.longitude
    };
}

async function searchCitiesOnline(query, limit = 7) {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const params = new URLSearchParams({
        name: trimmed,
        count: String(limit),
        language: 'ru',
        format: 'json'
    });

    const url = `https://geocoding-api.open-meteo.com/v1/search?${params.toString()}`;
    const res = await fetch(url);

    if (!res.ok) {
        throw new Error(`Ошибка HTTP геокодинга: ${res.status}`);
    }

    const data = await res.json();
    if (!data.results || !Array.isArray(data.results)) {
        return [];
    }

    return data.results.map(buildCityFromApiItem);
}


function setupAutocomplete(inputEl, suggestionsEl, errorEl, onCitySelected) {
    let typingTimeout = null;

    function hideSuggestions() {
        suggestionsEl.classList.add('suggestions--hidden');
        suggestionsEl.innerHTML = '';
    }

    function renderSuggestions(items) {
        suggestionsEl.innerHTML = '';
        if (!items.length) {
            hideSuggestions();
            return;
        }
        items.forEach(city => {
            const li = document.createElement('li');
            const countryText = city.country ? ` (${city.country})` : '';
            li.textContent = `${city.name}${countryText}`;
            li.addEventListener('mousedown', (e) => {
                e.preventDefault();
                inputEl.value = city.name;
                inputEl.dataset.selectedCityId = String(city.id);
                inputEl.dataset.selectedCityLat = String(city.lat);
                inputEl.dataset.selectedCityLon = String(city.lon);
                inputEl.dataset.selectedCityCountry = city.country || '';
                hideSuggestions();
                if (errorEl) errorEl.textContent = '';
                if (typeof onCitySelected === 'function') {
                    onCitySelected(city);
                }
            });
            suggestionsEl.appendChild(li);
        });
        suggestionsEl.classList.remove('suggestions--hidden');
    }

    async function performSearch(query) {
        try {
            const results = await searchCitiesOnline(query);
            renderSuggestions(results);
        } catch (e) {
            console.warn('Ошибка поиска города:', e);
        }
    }

    inputEl.addEventListener('input', () => {
        const value = inputEl.value;

        inputEl.removeAttribute('data-selected-city-id');
        inputEl.removeAttribute('data-selected-city-lat');
        inputEl.removeAttribute('data-selected-city-lon');
        inputEl.removeAttribute('data-selected-city-country');

        if (errorEl) errorEl.textContent = '';

        clearTimeout(typingTimeout);

        if (!value.trim()) {
            hideSuggestions();
            return;
        }

        typingTimeout = setTimeout(() => {
            performSearch(value);
        }, 300);
    });

    inputEl.addEventListener('blur', () => {
        setTimeout(hideSuggestions, 150);
    });
}


function showMainCityModal() {
    const overlay = document.getElementById('modal-overlay');
    overlay.classList.remove('modal-overlay--hidden');
}

function hideMainCityModal() {
    const overlay = document.getElementById('modal-overlay');
    overlay.classList.add('modal-overlay--hidden');
}


function requestGeolocationAndRender() {
    const statusEl = document.getElementById('main-status');
    const forecastContainer = document.getElementById('main-forecast');
    const titleEl = document.getElementById('main-location-title');

    titleEl.textContent = 'Текущее местоположение';
    statusEl.textContent = 'Определяем текущее местоположение...';
    statusEl.className = 'status status--loading';
    forecastContainer.innerHTML = '';

    if (!('geolocation' in navigator)) {
        statusEl.textContent = 'Геолокация не поддерживается. Выберите город вручную.';
        statusEl.className = 'status status--error';
        appState.useGeolocation = false;
        saveState();
        showMainCityModal();
        return;
    }

    navigator.geolocation.getCurrentPosition(
        (pos) => {
            const lat = pos.coords.latitude;
            const lon = pos.coords.longitude;

            appState.useGeolocation = true;
            appState.mainCity = null;
            saveState();

            renderForecastForCoords({
                lat,
                lon,
                statusEl,
                forecastContainer
            });
        },
        (error) => {
            console.warn('Ошибка геолокации:', error);
            statusEl.textContent = 'Не удалось получить геолокацию. Выберите город вручную.';
            statusEl.className = 'status status--error';
            appState.useGeolocation = false;
            saveState();
            showMainCityModal();
        },
        {
            enableHighAccuracy: true,
            timeout: 10000
        }
    );
}


function renderMainCity() {
    const city = appState.mainCity;
    const statusEl = document.getElementById('main-status');
    const forecastContainer = document.getElementById('main-forecast');
    const titleEl = document.getElementById('main-location-title');

    if (!city) {
        statusEl.textContent = 'Город не выбран.';
        statusEl.className = 'status status--error';
        return;
    }

    const countryText = city.country ? ` (${city.country})` : '';
    titleEl.textContent = `${city.name}${countryText}`;

    renderForecastForCoords({
        lat: city.lat,
        lon: city.lon,
        statusEl,
        forecastContainer
    });
}


function createCityCard(city) {
    const card = document.createElement('div');
    card.className = 'city-card';
    card.dataset.cityId = String(city.id);

    const header = document.createElement('div');
    header.className = 'city-card__header';

    const nameEl = document.createElement('h3');
    nameEl.className = 'city-card__name';
    const countryText = city.country ? ` (${city.country})` : '';
    nameEl.textContent = `${city.name}${countryText}`;

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'city-card__remove';
    removeBtn.textContent = '×';
    removeBtn.title = 'Удалить город';

    removeBtn.addEventListener('click', () => {
        appState.extraCities = appState.extraCities.filter(c => c.id !== city.id);
        saveState();
        card.remove();
    });

    header.appendChild(nameEl);
    header.appendChild(removeBtn);

    const statusEl = document.createElement('div');
    statusEl.className = 'status';

    const forecastContainer = document.createElement('div');
    forecastContainer.className = 'forecast-grid';

    card.appendChild(header);
    card.appendChild(statusEl);
    card.appendChild(forecastContainer);

    renderForecastForCoords({
        lat: city.lat,
        lon: city.lon,
        statusEl,
        forecastContainer
    });

    return card;
}

function rerenderExtraCities() {
    const container = document.getElementById('extra-cities');
    container.innerHTML = '';
    appState.extraCities.forEach(city => {
        const card = createCityCard(city);
        container.appendChild(card);
    });
}

function refreshAll() {
    if (appState.useGeolocation) {
        requestGeolocationAndRender();
    } else if (appState.mainCity) {
        renderMainCity();
    }

    const container = document.getElementById('extra-cities');
    const cards = Array.from(container.querySelectorAll('.city-card'));
    cards.forEach(card => {
        const id = Number(card.dataset.cityId);
        const city = appState.extraCities.find(c => c.id === id);
        if (!city) return;

        const statusEl = card.querySelector('.status');
        const forecastContainer = card.querySelector('.forecast-grid');

        renderForecastForCoords({
            lat: city.lat,
            lon: city.lon,
            statusEl,
            forecastContainer
        });
    });
}

function init() {
    loadState();

    const mainStatusEl = document.getElementById('main-status');

    const cityInput = document.getElementById('city-input');
    const citySuggestions = document.getElementById('city-suggestions');
    const cityError = document.getElementById('city-error');
    const addCityForm = document.getElementById('add-city-form');

    setupAutocomplete(cityInput, citySuggestions, cityError);

    addCityForm.addEventListener('submit', (e) => {
        e.preventDefault();

        const name = cityInput.value.trim();
        const id = cityInput.dataset.selectedCityId;
        const lat = cityInput.dataset.selectedCityLat;
        const lon = cityInput.dataset.selectedCityLon;
        const country = cityInput.dataset.selectedCityCountry || '';

        if (!name) {
            cityError.textContent = 'Введите название города.';
            return;
        }
        if (!id || !lat || !lon) {
            cityError.textContent = 'Выберите город из выпадающего списка.';
            return;
        }

        const cityObj = {
            id: Number(id),
            name,
            country,
            lat: Number(lat),
            lon: Number(lon)
        };

        if (appState.extraCities.some(c => c.id === cityObj.id)) {
            cityError.textContent = 'Этот город уже добавлен.';
            return;
        }
        if (!appState.useGeolocation && appState.mainCity && appState.mainCity.id === cityObj.id) {
            cityError.textContent = 'Этот город уже выбран как основной.';
            return;
        }

        appState.extraCities.push(cityObj);
        saveState();

        cityError.textContent = '';
        cityInput.value = '';
        cityInput.removeAttribute('data-selected-city-id');
        cityInput.removeAttribute('data-selected-city-lat');
        cityInput.removeAttribute('data-selected-city-lon');
        cityInput.removeAttribute('data-selected-city-country');

        const container = document.getElementById('extra-cities');
        const card = createCityCard(cityObj);
        container.appendChild(card);
    });

    const modalCityInput = document.getElementById('modal-city-input');
    const modalCitySuggestions = document.getElementById('modal-city-suggestions');
    const modalCityError = document.getElementById('modal-city-error');
    const modalCityForm = document.getElementById('modal-city-form');

    setupAutocomplete(modalCityInput, modalCitySuggestions, modalCityError);

    modalCityForm.addEventListener('submit', (e) => {
        e.preventDefault();

        const name = modalCityInput.value.trim();
        const id = modalCityInput.dataset.selectedCityId;
        const lat = modalCityInput.dataset.selectedCityLat;
        const lon = modalCityInput.dataset.selectedCityLon;
        const country = modalCityInput.dataset.selectedCityCountry || '';

        if (!name) {
            modalCityError.textContent = 'Введите название города.';
            return;
        }
        if (!id || !lat || !lon) {
            modalCityError.textContent = 'Выберите город из выпадающего списка.';
            return;
        }

        const cityObj = {
            id: Number(id),
            name,
            country,
            lat: Number(lat),
            lon: Number(lon)
        };

        appState.useGeolocation = false;
        appState.mainCity = cityObj;
        saveState();

        hideMainCityModal();
        modalCityError.textContent = '';

        renderMainCity();
    });

    const refreshButton = document.getElementById('refresh-button');
    refreshButton.addEventListener('click', () => {
        refreshAll();
    });

    if (appState.useGeolocation) {
        requestGeolocationAndRender();
    } else if (appState.mainCity) {
        renderMainCity();
    } else {
        mainStatusEl.textContent = 'Выберите основной город для отображения прогноза.';
        mainStatusEl.className = 'status';
        showMainCityModal();
    }

    rerenderExtraCities();
}

document.addEventListener('DOMContentLoaded', init);
