
import React from 'react';
import { useTranslation } from 'react-i18next';
import './LanguageSwitcher.css'; // <--- import your stylesheet

const LanguageSwitcher: React.FC = () => {
    const { i18n } = useTranslation();

    const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
        const selectedLang = event.target.value;
        i18n.changeLanguage(selectedLang);
    };

    const t = useTranslation().t;

    return (
        <div className="language-switcher">
            <label htmlFor="lang-select" className="lang-label">
                {t('lng.lng')}
            </label>
            <select
                id="lang-select"
                onChange={handleChange}
                value={i18n.language}
                className="lang-select"
            >
                <option value="en">English</option>
                <option value="de">Deutsch</option>
                <option value="fr">Français</option>
                <option value="it">Italiano</option>
            </select>
        </div>
    );
};

export default LanguageSwitcher;
