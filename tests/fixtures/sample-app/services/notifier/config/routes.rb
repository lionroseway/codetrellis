# Rails router. `resources` is how a real application declares its API —
# an extractor that only read explicit verbs would find nothing here.
Rails.application.routes.draw do
  namespace :api do
    resources :notifications, only: [:index, :create, :show]

    resources :digests, only: [:index] do
      member do
        post '/send'
      end
    end

    get '/health', to: 'health#show'
  end
end
