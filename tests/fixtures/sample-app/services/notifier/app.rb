# frozen_string_literal: true

require_relative 'lib/notifier'

# Entry point for the fixture notifier service.
def main
  Notifier::Dispatcher.default.dispatch('hello', 'world')
end

# Calls the Python API — a cross-language edge from Ruby.
class UserFetcher
  def all
    Net::HTTP.get(URI('http://api.internal/api/users'))
  end

  def create(payload)
    HTTParty.post('http://api.internal/api/users', body: payload)
  end
end
