const convertButton = document.querySelector('.convert-button');
const amountInput = document.querySelector('input');
const currencyTo = document.querySelectorAll('select')[1];
const values = document.querySelectorAll('.moeda-valor');
const toName = document.querySelectorAll('.moeda-nome')[1];
const toFlag = document.querySelectorAll('.moeda img')[1];

const currencies = {
  USD: {
    name: 'Dólar americano',
    rate: 1 / 5.45,
    code: 'USD',
    flag: './estados-unidos (1) 1.png',
  },
  EUR: {
    name: 'Euro',
    rate: 1 / 6.35,
    code: 'EUR',
    flag: './Design sem nome 3.png',
  },
  BTC: {
    name: 'Bitcoin',
    rate: 0.000023,
    code: 'BTC',
    flag: './bitcoin 1.svg',
  },
  GBP: {
    name: 'Libra esterlina',
    rate: 1 / 7.25,
    code: 'GBP',
    flag: './libra 1.svg',
  }
};

function formatCurrency(value, currency) {
  const options = {
    style: 'currency',
    currency,
  };

  if (currency === 'BTC') {
    options.minimumFractionDigits = 8;
    options.maximumFractionDigits = 8;
  }

  return new Intl.NumberFormat('pt-BR', options).format(value);
}

function convertValues() {
  const amount = Number(amountInput.value.replace(',', '.'));
  const selectedCurrency = currencyTo.value.includes('Euro') ? currencies.EUR : currencyTo.value.includes('Bitcoin') ? currencies.BTC : currencyTo.value.includes('Libra') ? currencies.GBP : currencies.USD;

  if (!Number.isFinite(amount) || amount < 0) {
    amountInput.focus();
    return;
  }

  values[0].textContent = formatCurrency(amount, 'BRL');
  toName.textContent = selectedCurrency.name;
  values[1].textContent = formatCurrency(amount * selectedCurrency.rate, selectedCurrency.code);
  toFlag.src = selectedCurrency.flag;
  toFlag.alt = `Bandeira da moeda ${selectedCurrency.name}`;
}

convertButton.addEventListener('click', convertValues);
amountInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    convertValues();
  }
});

  