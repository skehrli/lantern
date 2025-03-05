class SimulatorApp {
    constructor() {
        this.initializeUI();
        this.attachEventListeners();
    }

    initializeUI() {
        const appDiv = document.getElementById('app');
        appDiv.innerHTML = `
            <div class="container">
                <h1>Energy Community Simulator</h1>
                
                <form id="simulationForm" class="form">
                    <div class="form-group">
                        <label class="form-label">Community Size (5-100):</label>
                        <input type="number" name="community_size" min="5" max="100" required
                               class="form-input">
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label">Season:</label>
                        <select name="season" required class="form-input">
                            <option value="sum">Summer</option>
                            <option value="win">Winter</option>
                            <option value="aut">Autumn</option>
                            <option value="spr">Spring</option>
                        </select>
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label">PV Percentage (0-100):</label>
                        <input type="number" name="pv_percentage" min="0" max="100" required
                               class="form-input">
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label">Smart Devices Percentage (0-100):</label>
                        <input type="number" name="sd_percentage" min="0" max="100" required
                               class="form-input">
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label">
                            <input type="checkbox" name="with_battery">
                            Include Battery
                        </label>
                    </div>
                    
                    <button type="submit" class="btn">Run Simulation</button>
                </form>
                
                <div id="results" class="results"></div>
            </div>
        `;
    }

    attachEventListeners() {
        const form = document.getElementById('simulationForm');
        form.addEventListener('submit', this.handleSubmit.bind(this));
    }

    async handleSubmit(event) {
        event.preventDefault();
        const form = event.target;
        const formData = new FormData(form);
        
        const data = {
            community_size: parseInt(formData.get('community_size')),
            season: formData.get('season'),
            pv_percentage: parseInt(formData.get('pv_percentage')),
            sd_percentage: parseInt(formData.get('sd_percentage')),
            with_battery: formData.get('with_battery') === 'on'
        };
        
        try {
            const response = await fetch('/simulate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data)
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const result = await response.json();
            this.displayResults(result);
        } catch (error) {
            console.error('Error:', error);
            this.displayError(error);
        }
    }

    displayResults(result) {
        const resultsDiv = document.getElementById('results');
        
        // Display plots
        let plotsHtml = '<div class="plots">';
        for (const [name, plotData] of Object.entries(result.plots)) {
            plotsHtml += `
                <div class="plot">
                    <h3>${name}</h3>
                    ${this.renderPlot(plotData)}
                </div>
            `;
        }
        plotsHtml += '</div>';
        
        // Display summary
        const summaryHtml = `
            <div class="summary">
                <h2>Summary</h2>
                <p>Cost With LEC: ${result.cost_metrics.cost_with_lec.toFixed(2)}%</p>
                <p>Cost Without LEC: ${result.cost_metrics.cost_without_lec.toFixed(2)}%</p>
                <p>Total PV Production: ${result.energy_metrics.total_production.toFixed(2)} kWh</p>
                <p>Total Consumption: ${result.energy_metrics.total_consumption.toFixed(2)} kWh</p>
            </div>
        `;
        
        resultsDiv.innerHTML = plotsHtml + summaryHtml;
    }

    renderPlot(plotData) {
        if (plotData.type === 'image') {
            return `<img src="data:image/png;base64,${plotData.data}" alt="Plot">`;
        } else if (plotData.type === 'plotly') {
            const plotId = 'plot-' + Math.random().toString(36).substr(2, 9);
            setTimeout(() => {
                Plotly.newPlot(plotId, plotData.data.data, plotData.data.layout);
            }, 0);
            return `<div id="${plotId}"></div>`;
        }
        return '';
    }

    displayError(error) {
        const resultsDiv = document.getElementById('results');
        resultsDiv.innerHTML = `
            <div class="error">
                <h2>Error</h2>
                <p>${error.message}</p>
            </div>
        `;
    }
}

// Initialize the app when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new SimulatorApp();
});
